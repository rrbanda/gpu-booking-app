package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Resource pool matching applications/rbac/values.yaml totalResources.h200
type gpuSpec struct {
	Count int
	Share float64
}

var h200Resources = map[string]gpuSpec{
	"nvidia.com/gpu":         {Count: 8, Share: 0.0625},
	"nvidia.com/mig-3g.71gb": {Count: 8, Share: 0.03125},
	"nvidia.com/mig-2g.35gb": {Count: 8, Share: 0.015625},
	"nvidia.com/mig-1g.18gb": {Count: 16, Share: 0.0078125},
}

const (
	h200TotalCPU             = 316
	h200TotalMemory          = 3460 // Gi
	reservationCleanInterval = 10 * time.Minute
)

// reservationSyncEnabled controls whether reservation sync and cleanup are active.
// Toggled at runtime via the admin API. Defaults to true.
var reservationSyncEnabled = true

// userReservation holds computed quotas for a single user's reservation.
type userReservation struct {
	User      string
	Resources map[string]int // GPU resource type -> count
	CPU       int
	Memory    int // Gi
	Until     int64
}

func initReservationSync() {
	if k8sHost == "" || k8sToken == "" {
		log.Println("reservation sync: not running in-cluster, disabling")
		return
	}
	log.Println("reservation sync: enabled, cleaner interval=10m")
	go reservationCleanerLoop()
}

func reservationCleanerLoop() {
	time.Sleep(10 * time.Second)
	for {
		if reservationSyncEnabled {
			syncReservations()
			if err := cleanExpiredReservations(); err != nil {
				log.Printf("reservation cleaner error: %v", err)
			}
		}
		time.Sleep(reservationCleanInterval)
	}
}

// syncReservations rebuilds reservation resources based on today's active bookings.
// Called asynchronously after booking create/delete.
func syncReservations() {
	if k8sHost == "" || k8sToken == "" || !reservationSyncEnabled {
		return
	}

	reservations, err := getActiveReservations()
	if err != nil {
		log.Printf("reservation sync: %v", err)
		return
	}

	// Apply reservations for users with active bookings
	for _, res := range reservations {
		if err := applyUserReservation(res); err != nil {
			log.Printf("reservation sync: failed to apply for user %s: %v", res.User, err)
		}
	}

	// Clean up reservations for users who no longer have bookings today
	// (e.g. booking was cancelled)
	activeUsers := map[string]bool{}
	for _, res := range reservations {
		activeUsers["user-"+res.User] = true
	}
	if err := removeStaleReservations(activeUsers); err != nil {
		log.Printf("reservation sync: failed to remove stale: %v", err)
	}

	// Update the unreserved Cohort with remaining resources
	if err := applyCohortRemaining(reservations); err != nil {
		log.Printf("reservation sync: failed to update cohort: %v", err)
	}

	if len(reservations) > 0 {
		log.Printf("reservation sync: applied %d user reservations", len(reservations))
	}
}

// getActiveReservations queries today's manual bookings and computes per-user quotas.
// The until timestamp is based on the latest end_hour across the user's bookings.
func getActiveReservations() ([]userReservation, error) {
	today := time.Now().Format("2006-01-02")

	rows, err := db.Query(
		`SELECT user, resource, COUNT(DISTINCT slot_index) as unit_count, MAX(end_hour) as max_end_hour
		 FROM bookings WHERE date = ? AND source = 'reserved'
		 GROUP BY user, resource`,
		today,
	)
	if err != nil {
		return nil, fmt.Errorf("querying reservations: %w", err)
	}
	defer rows.Close()

	userMap := map[string]map[string]int{}
	userMaxEndHour := map[string]int{} // track latest end hour per user
	for rows.Next() {
		var user, resource string
		var count, maxEndHour int
		if err := rows.Scan(&user, &resource, &count, &maxEndHour); err != nil {
			continue
		}
		if !isGPUResource(resource) {
			continue
		}
		if _, ok := userMap[user]; !ok {
			userMap[user] = map[string]int{}
		}
		userMap[user][resource] += count

		if maxEndHour > userMaxEndHour[user] {
			userMaxEndHour[user] = maxEndHour
		}
	}

	now := time.Now().UTC()

	var reservations []userReservation
	for user, resources := range userMap {
		endHour := userMaxEndHour[user]
		if endHour <= 0 {
			endHour = 24
		}
		var until time.Time
		if endHour >= 24 {
			// Midnight = start of next day
			until = time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
		} else {
			until = time.Date(now.Year(), now.Month(), now.Day(), endHour, 0, 0, 0, time.UTC)
		}

		res := userReservation{
			User:      user,
			Resources: resources,
			Until:     until.Unix(),
		}
		for gpuRes, count := range resources {
			spec, ok := h200Resources[gpuRes]
			if !ok {
				continue
			}
			share := float64(count) * spec.Share
			res.CPU += int(math.Floor(share * h200TotalCPU))
			res.Memory += int(math.Floor(share * h200TotalMemory))
		}
		reservations = append(reservations, res)
	}

	return reservations, nil
}

// normalizedResourceID matches the rbac chart's rbac.normalized-resource-id helper.
func normalizedResourceID(resource string) string {
	switch resource {
	case "nvidia.com/gpu":
		return "gpu"
	case "nvidia.com/mig-3g.71gb":
		return "mig-71gb"
	case "nvidia.com/mig-2g.35gb":
		return "mig-35gb"
	case "nvidia.com/mig-1g.18gb":
		return "mig-18gb"
	}
	return "unk"
}

// applyUserReservation creates/updates the ClusterQueue, LocalQueue, and HardwareProfile(s)
// for a single user's reservation via server-side apply.
func applyUserReservation(res userReservation) error {
	ns := "user-" + res.User
	untilStr := strconv.FormatInt(res.Until, 10)

	// 1. ClusterQueue
	coveredResources := []string{"cpu", "memory"}
	quotaResources := []map[string]any{
		{"name": "cpu", "nominalQuota": strconv.Itoa(res.CPU)},
		{"name": "memory", "nominalQuota": fmt.Sprintf("%dGi", res.Memory)},
	}
	for gpuRes, count := range res.Resources {
		coveredResources = append(coveredResources, gpuRes)
		quotaResources = append(quotaResources, map[string]any{
			"name": gpuRes, "nominalQuota": strconv.Itoa(count),
		})
	}

	cq := map[string]any{
		"apiVersion": "kueue.x-k8s.io/v1beta1",
		"kind":       "ClusterQueue",
		"metadata": map[string]any{
			"name": ns,
			"labels": map[string]string{
				"rhai-tmm.dev/until": untilStr,
			},
		},
		"spec": map[string]any{
			"cohort": "unreserved",
			"namespaceSelector": map[string]any{
				"matchLabels": map[string]string{
					"kubernetes.io/metadata.name": ns,
				},
			},
			"preemption": map[string]any{
				"borrowWithinCohort": map[string]any{
					"policy": "Never",
				},
				"reclaimWithinCohort": "Any",
				"withinClusterQueue":  "Never",
			},
			"flavorFungibility": map[string]any{
				"whenCanBorrow":  "Borrow",
				"whenCanPreempt": "TryNextFlavor",
			},
			"queueingStrategy": "BestEffortFIFO",
			"stopPolicy":       "None",
			"resourceGroups": []map[string]any{
				{
					"coveredResources": coveredResources,
					"flavors": []map[string]any{
						{
							"name":      "h200",
							"resources": quotaResources,
						},
					},
				},
			},
		},
	}
	if err := k8sApply("/apis/kueue.x-k8s.io/v1beta1/clusterqueues/"+ns, cq); err != nil {
		return fmt.Errorf("applying ClusterQueue %s: %w", ns, err)
	}

	// 2. LocalQueue
	lq := map[string]any{
		"apiVersion": "kueue.x-k8s.io/v1beta1",
		"kind":       "LocalQueue",
		"metadata": map[string]any{
			"name":      "reserved",
			"namespace": ns,
			"labels": map[string]string{
				"rhai-tmm.dev/until": untilStr,
			},
			"annotations": map[string]string{
				"argocd.argoproj.io/sync-options": "SkipDryRunOnMissingResource=true",
				"argocd.argoproj.io/sync-wave":    "1",
			},
		},
		"spec": map[string]any{
			"clusterQueue": ns,
		},
	}
	if err := k8sApply(fmt.Sprintf("/apis/kueue.x-k8s.io/v1beta1/namespaces/%s/localqueues/reserved", ns), lq); err != nil {
		log.Printf("reservation sync: failed to apply LocalQueue for %s: %v", ns, err)
	}

	// 3. HardwareProfile(s) - one per GPU resource type
	for gpuRes, count := range res.Resources {
		normalized := normalizedResourceID(gpuRes)
		profileName := "reserved-" + normalized

		identifiers := []map[string]any{
			{
				"identifier":   "cpu",
				"displayName":  "CPU",
				"resourceType": "CPU",
				"minCount":     1,
				"maxCount":     res.CPU,
				"defaultCount": 2,
			},
			{
				"identifier":   "memory",
				"displayName":  "Memory",
				"resourceType": "Memory",
				"minCount":     "2Gi",
				"maxCount":     fmt.Sprintf("%dGi", res.Memory),
				"defaultCount": "8Gi",
			},
			{
				"identifier":   gpuRes,
				"displayName":  strings.ToUpper(normalized),
				"resourceType": "Accelerator",
				"minCount":     1,
				"maxCount":     count,
				"defaultCount": 1,
			},
		}

		hp := map[string]any{
			"apiVersion": "infrastructure.opendatahub.io/v1",
			"kind":       "HardwareProfile",
			"metadata": map[string]any{
				"name":      profileName,
				"namespace": ns,
				"labels": map[string]string{
					"rhai-tmm.dev/until": untilStr,
				},
				"annotations": map[string]string{
					"opendatahub.io/dashboard-feature-visibility": "[]",
					"opendatahub.io/disabled":                     "false",
					"opendatahub.io/display-name":                 "Reserved " + strings.ToUpper(normalized),
					"opendatahub.io/managed":                      "false",
					"opendatahub.io/description":                  fmt.Sprintf("Your reserved quota of %d %s", count, gpuRes),
				},
			},
			"spec": map[string]any{
				"identifiers": identifiers,
				"scheduling": map[string]any{
					"type": "Queue",
					"kueue": map[string]any{
						"localQueueName": "reserved",
						"priorityClass":  "None",
					},
				},
			},
		}

		if err := k8sApply(
			fmt.Sprintf("/apis/infrastructure.opendatahub.io/v1/namespaces/%s/hardwareprofiles/%s", ns, profileName),
			hp,
		); err != nil {
			log.Printf("reservation sync: failed to apply HardwareProfile %s/%s: %v", ns, profileName, err)
		}
	}

	return nil
}

// applyCohortRemaining updates the unreserved Cohort with total resources minus
// all active reservations, so the shared pool reflects what's actually available.
func applyCohortRemaining(reservations []userReservation) error {
	// Start with full resource pool
	remainingCPU := h200TotalCPU
	remainingMem := h200TotalMemory
	remainingGPUs := map[string]int{}
	for res, spec := range h200Resources {
		remainingGPUs[res] = spec.Count
	}

	// Subtract each user's reservation
	for _, res := range reservations {
		remainingCPU -= res.CPU
		remainingMem -= res.Memory
		for gpuRes, count := range res.Resources {
			remainingGPUs[gpuRes] -= count
		}
	}

	// Build the Cohort resource list
	coveredResources := []string{"cpu", "memory"}
	quotaResources := []map[string]any{
		{"name": "cpu", "nominalQuota": strconv.Itoa(remainingCPU)},
		{"name": "memory", "nominalQuota": fmt.Sprintf("%dGi", remainingMem)},
	}
	for res, count := range remainingGPUs {
		coveredResources = append(coveredResources, res)
		quotaResources = append(quotaResources, map[string]any{
			"name": res, "nominalQuota": strconv.Itoa(count),
		})
	}

	cohort := map[string]any{
		"apiVersion": "kueue.x-k8s.io/v1beta1",
		"kind":       "Cohort",
		"metadata": map[string]any{
			"name": "unreserved",
		},
		"spec": map[string]any{
			"resourceGroups": []map[string]any{
				{
					"coveredResources": coveredResources,
					"flavors": []map[string]any{
						{
							"name":      "h200",
							"resources": quotaResources,
						},
					},
				},
			},
		},
	}

	return k8sApply("/apis/kueue.x-k8s.io/v1beta1/cohorts/unreserved", cohort)
}

// removeStaleReservations deletes reservation resources for users who no longer have
// active bookings today (e.g. after a booking cancellation).
func removeStaleReservations(activeUsers map[string]bool) error {
	items, err := k8sListWithLabel(
		"/apis/kueue.x-k8s.io/v1beta1/clusterqueues",
		"rhai-tmm.dev/until",
	)
	if err != nil {
		return fmt.Errorf("listing labeled ClusterQueues: %w", err)
	}

	for _, item := range items {
		if activeUsers[item.Name] {
			continue
		}
		// This ClusterQueue has an until label but the user has no active bookings
		deleteUserReservationResources(item.Name)
		log.Printf("reservation sync: removed stale reservation for %s", item.Name)
	}

	return nil
}

// cleanExpiredReservations finds and removes reservation resources past their until time.
func cleanExpiredReservations() error {
	now := time.Now().UTC().Unix()

	items, err := k8sListWithLabel(
		"/apis/kueue.x-k8s.io/v1beta1/clusterqueues",
		"rhai-tmm.dev/until",
	)
	if err != nil {
		return fmt.Errorf("listing labeled ClusterQueues: %w", err)
	}

	var expired, active int
	for _, item := range items {
		untilStr, ok := item.Labels["rhai-tmm.dev/until"]
		if !ok {
			continue
		}
		until, err := strconv.ParseInt(untilStr, 10, 64)
		if err != nil {
			continue
		}
		if until < now {
			deleteUserReservationResources(item.Name)
			log.Printf("reservation cleaner: deleted expired reservation for %s (until=%s)", item.Name, untilStr)
			expired++
		} else {
			active++
		}
	}

	if expired > 0 {
		log.Printf("reservation cleaner: removed %d expired, %d active remain", expired, active)
	}

	return nil
}

// deleteUserReservationResources removes the ClusterQueue, LocalQueue, and HardwareProfiles
// for a reservation namespace (e.g. "user-mhepburn").
func deleteUserReservationResources(ns string) {
	// Delete HardwareProfiles with the until label
	hpItems, err := k8sListWithLabel(
		fmt.Sprintf("/apis/infrastructure.opendatahub.io/v1/namespaces/%s/hardwareprofiles", ns),
		"rhai-tmm.dev/until",
	)
	if err == nil {
		for _, hp := range hpItems {
			if err := k8sDeletePath(fmt.Sprintf(
				"/apis/infrastructure.opendatahub.io/v1/namespaces/%s/hardwareprofiles/%s", ns, hp.Name,
			)); err != nil {
				log.Printf("reservation cleanup: failed to delete HardwareProfile %s/%s: %v", ns, hp.Name, err)
			}
		}
	}

	// Delete LocalQueue
	if err := k8sDeletePath(fmt.Sprintf(
		"/apis/kueue.x-k8s.io/v1beta1/namespaces/%s/localqueues/reserved", ns,
	)); err != nil {
		log.Printf("reservation cleanup: failed to delete LocalQueue %s/reserved: %v", ns, err)
	}

	// Delete ClusterQueue
	if err := k8sDeletePath(fmt.Sprintf(
		"/apis/kueue.x-k8s.io/v1beta1/clusterqueues/%s", ns,
	)); err != nil {
		log.Printf("reservation cleanup: failed to delete ClusterQueue %s: %v", ns, err)
	}
}

// k8sApply performs a server-side apply (PATCH) on a K8s resource.
func k8sApply(path string, manifest map[string]any) error {
	body, err := json.Marshal(manifest)
	if err != nil {
		return fmt.Errorf("marshaling manifest: %w", err)
	}

	u := k8sHost + path + "?fieldManager=booking-app&force=true"
	req, err := http.NewRequest("PATCH", u, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+k8sToken)
	req.Header.Set("Content-Type", "application/apply-patch+yaml")
	req.Header.Set("Accept", "application/json")

	resp, err := k8sHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("k8s apply %s: %w", path, err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return fmt.Errorf("k8s apply %s returned %d: %s", path, resp.StatusCode, truncateBody(respBody))
	}

	return nil
}

// k8sDeletePath deletes a K8s resource at the given API path.
func k8sDeletePath(path string) error {
	req, err := http.NewRequest("DELETE", k8sHost+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+k8sToken)
	req.Header.Set("Accept", "application/json")

	resp, err := k8sHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("k8s delete %s: %w", path, err)
	}
	defer resp.Body.Close()
	io.ReadAll(resp.Body)

	if resp.StatusCode >= 300 && resp.StatusCode != 404 {
		return fmt.Errorf("k8s delete %s returned %d", path, resp.StatusCode)
	}

	return nil
}

// k8sResourceItem represents a minimal k8s resource from a list response.
type k8sResourceItem struct {
	Name      string
	Namespace string
	Labels    map[string]string
}

// k8sListWithLabel lists k8s resources matching a label key.
func k8sListWithLabel(basePath, labelKey string) ([]k8sResourceItem, error) {
	path := fmt.Sprintf("%s?labelSelector=%s", basePath, url.QueryEscape(labelKey))
	body, err := k8sGet(path)
	if err != nil {
		return nil, err
	}

	var result struct {
		Items []struct {
			Metadata struct {
				Name      string            `json:"name"`
				Namespace string            `json:"namespace"`
				Labels    map[string]string `json:"labels"`
			} `json:"metadata"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parsing list response: %w", err)
	}

	items := make([]k8sResourceItem, len(result.Items))
	for i, item := range result.Items {
		items[i] = k8sResourceItem{
			Name:      item.Metadata.Name,
			Namespace: item.Metadata.Namespace,
			Labels:    item.Metadata.Labels,
		}
	}
	return items, nil
}

func truncateBody(body []byte) string {
	s := string(body)
	if len(s) > 200 {
		return s[:200] + "..."
	}
	return s
}
