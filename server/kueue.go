package main

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"
)

// Kubernetes API types for LocalQueue and Namespace

type k8sLocalQueueList struct {
	Items []k8sLocalQueue `json:"items"`
}

type k8sLocalQueue struct {
	Metadata k8sMetadata        `json:"metadata"`
	Status   k8sLocalQueueStatus `json:"status"`
}

type k8sMetadata struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

type k8sLocalQueueStatus struct {
	ReservingWorkloads int                    `json:"reservingWorkloads"`
	AdmittedWorkloads  int                    `json:"admittedWorkloads"`
	FlavorUsage        []k8sFlavorUsageEntry  `json:"flavorUsage"`
}

type k8sFlavorUsageEntry struct {
	Name      string              `json:"name"`
	Resources []k8sResourceUsage  `json:"resources"`
}

type k8sResourceUsage struct {
	Name  string `json:"name"`
	Total string `json:"total"`
}

type k8sNamespace struct {
	Metadata k8sNamespaceMetadata `json:"metadata"`
}

type k8sNamespaceMetadata struct {
	Name        string            `json:"name"`
	Labels      map[string]string `json:"labels"`
}

// resourceUsage tracks GPU usage per namespace/user
type resourceUsage struct {
	Namespace string
	User      string
	Resource  string
	Count     int
}

var (
	kueueSyncEnabled  bool
	kueueSyncInterval int
	kueueBookingDays  int // 0 = rest of current week
	k8sHost           string
	k8sToken          string
	k8sHTTPClient     *http.Client
	// nsOwnerLabel is the namespace label used to resolve the booking user from
	// a Kueue workload's namespace. Override via KUEUE_NS_OWNER_LABEL env var.
	nsOwnerLabel = envOrDefault("KUEUE_NS_OWNER_LABEL", "rhai-tmm.dev/owner")
)

// initK8sClient sets up the Kubernetes API client.
// If KUBECONFIG is explicitly set, it is used and failures are fatal for k8s features
// (no silent fallback to in-cluster which would be the wrong cluster).
// Otherwise tries in-cluster config first, then falls back to default kubeconfig paths.
func initK8sClient() {
	if kc := os.Getenv("KUBECONFIG"); kc != "" {
		if initK8sFromKubeconfig() {
			return
		}
		log.Printf("k8s client: KUBECONFIG=%s was set but failed to load; k8s features disabled (will NOT fall back to in-cluster)", kc)
		return
	}
	if initK8sInCluster() {
		return
	}
	if initK8sFromKubeconfig() {
		return
	}
	log.Println("k8s client: no cluster access available")
}

func initK8sInCluster() bool {
	host := os.Getenv("KUBERNETES_SERVICE_HOST")
	port := os.Getenv("KUBERNETES_SERVICE_PORT")
	if host == "" || port == "" {
		return false
	}
	k8sHost = fmt.Sprintf("https://%s:%s", host, port)

	tokenBytes, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/token")
	if err != nil {
		k8sHost = ""
		return false
	}
	k8sToken = strings.TrimSpace(string(tokenBytes))

	k8sHTTPClient = &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{},
		},
	}

	caCert, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt")
	if err == nil {
		pool, _ := x509.SystemCertPool()
		if pool == nil {
			pool = x509.NewCertPool()
		}
		pool.AppendCertsFromPEM(caCert)
		k8sHTTPClient.Transport.(*http.Transport).TLSClientConfig.RootCAs = pool
	}

	log.Printf("k8s client: using in-cluster config (%s)", k8sHost)
	return true
}

// kubeconfig represents the subset of a kubeconfig file we need.
// Works for both JSON and YAML since the JSON tags match kubeconfig field names.
type kubeconfig struct {
	CurrentContext string             `json:"current-context"`
	Clusters       []kubeconfigEntry  `json:"clusters"`
	Users          []kubeconfigEntry  `json:"users"`
	Contexts       []kubeconfigEntry  `json:"contexts"`
}

type kubeconfigEntry struct {
	Name    string                 `json:"name"`
	Cluster kubeconfigCluster      `json:"cluster,omitempty"`
	User    kubeconfigUser         `json:"user,omitempty"`
	Context kubeconfigContextValue `json:"context,omitempty"`
}

type kubeconfigCluster struct {
	Server                string `json:"server"`
	CertificateAuthorityData string `json:"certificate-authority-data"`
	InsecureSkipTLSVerify bool   `json:"insecure-skip-tls-verify"`
}

type kubeconfigUser struct {
	Token string `json:"token"`
}

type kubeconfigContextValue struct {
	Cluster   string `json:"cluster"`
	User      string `json:"user"`
	Namespace string `json:"namespace"`
}

func initK8sFromKubeconfig() bool {
	kubeconfigPath := os.Getenv("KUBECONFIG")
	if kubeconfigPath == "" {
		kubeconfigPath = os.ExpandEnv("$HOME/.kube/config")
	}

	data, err := os.ReadFile(kubeconfigPath)
	if err != nil {
		log.Printf("k8s client: cannot read kubeconfig at %s: %v", kubeconfigPath, err)
		return false
	}

	kc, err := parseKubeconfig(data, kubeconfigPath)
	if err != nil {
		log.Printf("k8s client: failed to parse kubeconfig: %v", err)
		return false
	}

	clusterName, userName := resolveContext(kc)
	cluster := findCluster(kc, clusterName)
	user := findUser(kc, userName)

	if cluster == nil || cluster.Server == "" {
		log.Printf("k8s client: kubeconfig has no cluster (looked for %q)", clusterName)
		return false
	}
	if user == nil || user.Token == "" {
		log.Printf("k8s client: kubeconfig has no bearer token for user %q (only token auth is supported)", userName)
		return false
	}

	k8sHost = cluster.Server
	k8sToken = user.Token

	tlsConfig := &tls.Config{}
	if cluster.InsecureSkipTLSVerify {
		tlsConfig.InsecureSkipVerify = true
	} else if cluster.CertificateAuthorityData != "" {
		caCert, err := base64.StdEncoding.DecodeString(cluster.CertificateAuthorityData)
		if err == nil {
			pool, _ := x509.SystemCertPool()
			if pool == nil {
				pool = x509.NewCertPool()
			}
			pool.AppendCertsFromPEM(caCert)
			tlsConfig.RootCAs = pool
		}
	}

	k8sHTTPClient = &http.Client{
		Timeout:   30 * time.Second,
		Transport: &http.Transport{TLSClientConfig: tlsConfig},
	}

	log.Printf("k8s client: using kubeconfig (%s)", k8sHost)
	return true
}

func parseKubeconfig(data []byte, path string) (*kubeconfig, error) {
	var kc kubeconfig

	// Try JSON first
	if err := json.Unmarshal(data, &kc); err == nil && len(kc.Clusters) > 0 {
		return &kc, nil
	}

	// Try kubectl/oc to convert YAML to JSON
	out, cmdErr := exec.Command("kubectl", "config", "view", "--minify", "--flatten", "--raw", "-o", "json", "--kubeconfig", path).Output()
	if cmdErr != nil {
		out, cmdErr = exec.Command("oc", "config", "view", "--minify", "--flatten", "--raw", "-o", "json", "--kubeconfig", path).Output()
	}
	if cmdErr == nil {
		if err := json.Unmarshal(out, &kc); err == nil {
			return &kc, nil
		}
	}

	// Neither kubectl nor oc available (e.g., container). Convert simple YAML
	// keys to JSON by exploiting the fact that YAML is a superset of JSON and
	// kubeconfig keys use the same names as our JSON tags. Replace YAML-only
	// booleans and strip comments so json.Unmarshal can parse it.
	yamlStr := string(data)
	// YAML allows bare true/false without quotes; JSON requires them to be booleans.
	// The kubeconfig struct uses bool fields so json.Unmarshal handles true/false fine.
	// Just need to ensure the overall structure parses as JSON-compatible.
	// Use a line-based converter for the simple kubeconfig subset.
	return parseSimpleYAMLKubeconfig(yamlStr)
}

// parseSimpleYAMLKubeconfig handles the common kubeconfig YAML format that
// kubectl/oc are not available to convert. It extracts clusters, users,
// contexts, and current-context properly.
func parseSimpleYAMLKubeconfig(yamlStr string) (*kubeconfig, error) {
	kc := &kubeconfig{}
	lines := strings.Split(yamlStr, "\n")

	// Track which top-level section we're in
	var section string // "clusters", "users", "contexts", ""
	var currentCluster *kubeconfigEntry
	var currentUser *kubeconfigEntry
	var inClusterBlock, inUserBlock bool

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		indent := len(line) - len(strings.TrimLeft(line, " "))

		if indent == 0 {
			inClusterBlock = false
			inUserBlock = false
			if strings.HasPrefix(trimmed, "current-context:") {
				kc.CurrentContext = strings.TrimSpace(strings.TrimPrefix(trimmed, "current-context:"))
			} else if trimmed == "clusters:" {
				section = "clusters"
			} else if trimmed == "users:" {
				section = "users"
			} else if trimmed == "contexts:" {
				section = "contexts"
			} else {
				section = ""
			}
			continue
		}

		if strings.HasPrefix(trimmed, "- name:") {
			name := strings.TrimSpace(strings.TrimPrefix(trimmed, "- name:"))
			switch section {
			case "clusters":
				kc.Clusters = append(kc.Clusters, kubeconfigEntry{Name: name})
				currentCluster = &kc.Clusters[len(kc.Clusters)-1]
				currentUser = nil
			case "users":
				kc.Users = append(kc.Users, kubeconfigEntry{Name: name})
				currentUser = &kc.Users[len(kc.Users)-1]
				currentCluster = nil
			case "contexts":
				kc.Contexts = append(kc.Contexts, kubeconfigEntry{Name: name})
			}
			inClusterBlock = false
			inUserBlock = false
			continue
		}

		if trimmed == "cluster:" {
			inClusterBlock = true
			inUserBlock = false
			continue
		}
		if trimmed == "user:" {
			inUserBlock = true
			inClusterBlock = false
			continue
		}

		if inClusterBlock && currentCluster != nil {
			if strings.HasPrefix(trimmed, "server:") {
				currentCluster.Cluster.Server = strings.TrimSpace(strings.TrimPrefix(trimmed, "server:"))
			} else if strings.HasPrefix(trimmed, "insecure-skip-tls-verify:") {
				val := strings.TrimSpace(strings.TrimPrefix(trimmed, "insecure-skip-tls-verify:"))
				currentCluster.Cluster.InsecureSkipTLSVerify = val == "true"
			} else if strings.HasPrefix(trimmed, "certificate-authority-data:") {
				currentCluster.Cluster.CertificateAuthorityData = strings.TrimSpace(strings.TrimPrefix(trimmed, "certificate-authority-data:"))
			}
		}

		if inUserBlock && currentUser != nil {
			if strings.HasPrefix(trimmed, "token:") {
				currentUser.User.Token = strings.TrimSpace(strings.TrimPrefix(trimmed, "token:"))
			}
		}

		if section == "contexts" && len(kc.Contexts) > 0 {
			ctx := &kc.Contexts[len(kc.Contexts)-1]
			if strings.HasPrefix(trimmed, "cluster:") {
				ctx.Context.Cluster = strings.TrimSpace(strings.TrimPrefix(trimmed, "cluster:"))
			} else if strings.HasPrefix(trimmed, "user:") {
				ctx.Context.User = strings.TrimSpace(strings.TrimPrefix(trimmed, "user:"))
			} else if strings.HasPrefix(trimmed, "namespace:") {
				ctx.Context.Namespace = strings.TrimSpace(strings.TrimPrefix(trimmed, "namespace:"))
			}
		}
	}

	if len(kc.Clusters) == 0 {
		return nil, fmt.Errorf("no clusters found in kubeconfig YAML")
	}
	return kc, nil
}

func resolveContext(kc *kubeconfig) (clusterName, userName string) {
	if kc.CurrentContext != "" {
		for _, ctx := range kc.Contexts {
			if ctx.Name == kc.CurrentContext {
				return ctx.Context.Cluster, ctx.Context.User
			}
		}
	}
	// No context match: fall back to first cluster/user
	if len(kc.Clusters) > 0 {
		clusterName = kc.Clusters[0].Name
	}
	if len(kc.Users) > 0 {
		userName = kc.Users[0].Name
	}
	return
}

func findCluster(kc *kubeconfig, name string) *kubeconfigCluster {
	for i := range kc.Clusters {
		if kc.Clusters[i].Name == name {
			return &kc.Clusters[i].Cluster
		}
	}
	if len(kc.Clusters) > 0 {
		return &kc.Clusters[0].Cluster
	}
	return nil
}

func findUser(kc *kubeconfig, name string) *kubeconfigUser {
	for i := range kc.Users {
		if kc.Users[i].Name == name {
			return &kc.Users[i].User
		}
	}
	if len(kc.Users) > 0 {
		return &kc.Users[0].User
	}
	return nil
}

func initKueueSync() {
	if !kueueSyncEnabled {
		log.Println("kueue sync disabled")
		return
	}
	if k8sHost == "" || k8sToken == "" {
		log.Println("kueue sync: no k8s client available, disabling")
		return
	}

	log.Printf("kueue sync: enabled, interval=%ds, bookingDays=%d (0=rest of week)", kueueSyncInterval, kueueBookingDays)

	go kueueSyncLoop()
}

func kueueSyncLoop() {
	// Initial sync after a short delay to let the server start
	time.Sleep(5 * time.Second)

	for {
		if err := kueueSync(); err != nil {
			log.Printf("kueue sync error: %v", err)
		}
		time.Sleep(time.Duration(kueueSyncInterval) * time.Second)
	}
}

func kueueSync() error {
	// 1. List all LocalQueues
	queues, err := listLocalQueues()
	if err != nil {
		return fmt.Errorf("listing local queues: %w", err)
	}

	// 2. Aggregate resource usage per namespace+resource across all LocalQueues
	// Multiple LocalQueues in the same namespace contribute to the same GPU pool
	type nsResKey struct{ ns, resource string }
	aggregated := map[nsResKey]int{}
	nsCache := map[string]string{} // namespace -> requester user

	for _, q := range queues.Items {
		if q.Status.ReservingWorkloads == 0 && q.Status.AdmittedWorkloads == 0 {
			continue
		}

		for _, flavor := range q.Status.FlavorUsage {
			for _, res := range flavor.Resources {
				count := parseResourceCount(res.Total)
				if count <= 0 {
					continue
				}

				if !isGPUResource(res.Name) {
					continue
				}

				key := nsResKey{q.Metadata.Namespace, res.Name}
				aggregated[key] += count

				// Cache namespace requester lookup
				if _, ok := nsCache[q.Metadata.Namespace]; !ok {
					user, err := getNamespaceRequester(q.Metadata.Namespace)
					if err != nil {
						log.Printf("kueue sync: cannot get requester for namespace %s: %v", q.Metadata.Namespace, err)
						user = q.Metadata.Namespace
					}
					nsCache[q.Metadata.Namespace] = user
				}
			}
		}
	}

	// Build final usage list from aggregated counts
	usages := []resourceUsage{}
	for key, count := range aggregated {
		usages = append(usages, resourceUsage{
			Namespace: key.ns,
			User:      nsCache[key.ns],
			Resource:  key.resource,
			Count:     count,
		})
	}

	// 3. Calculate booking dates
	dates := getBookingDates()

	// 4. Sync bookings - add missing, remove stale
	return syncBookings(usages, dates)
}

func listLocalQueues() (*k8sLocalQueueList, error) {
	body, err := k8sGet("/apis/kueue.x-k8s.io/v1beta1/localqueues")
	if err != nil {
		return nil, err
	}
	var list k8sLocalQueueList
	if err := json.Unmarshal(body, &list); err != nil {
		return nil, fmt.Errorf("parsing local queue list: %w", err)
	}
	return &list, nil
}

func getNamespaceRequester(ns string) (string, error) {
	body, err := k8sGet("/api/v1/namespaces/" + ns)
	if err != nil {
		return "", err
	}
	var namespace k8sNamespace
	if err := json.Unmarshal(body, &namespace); err != nil {
		return "", fmt.Errorf("parsing namespace: %w", err)
	}
	owner := namespace.Metadata.Labels[nsOwnerLabel]
	if owner == "" {
		return ns, nil // fallback to namespace name
	}
	return owner, nil
}

func k8sGet(path string) ([]byte, error) {
	req, err := http.NewRequest("GET", k8sHost+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+k8sToken)
	req.Header.Set("Accept", "application/json")

	resp, err := k8sHTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("k8s API request %s: %w", path, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading k8s API response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("k8s API %s returned %d: %s", path, resp.StatusCode, string(body))
	}

	return body, nil
}

func parseResourceCount(total string) int {
	// Resource quantities like "4", "8010m" (millicores), "131087Mi"
	// For GPU counts, these are whole numbers
	total = strings.TrimSpace(total)
	if total == "" || total == "0" {
		return 0
	}

	// Try parsing as plain integer (GPU counts)
	var count int
	if _, err := fmt.Sscanf(total, "%d", &count); err == nil {
		// If the string is exactly the number (no suffix), return it
		if fmt.Sprintf("%d", count) == total {
			return count
		}
	}

	return 0
}

func getBookingDates() []string {
	today := time.Now()
	var days int
	if kueueBookingDays > 0 {
		days = kueueBookingDays
	} else {
		// Through end of current week (Sunday), minimum 1 full week
		weekday := int(today.Weekday())
		if weekday == 0 {
			days = 7 // Sunday: book through next Sunday
		} else {
			days = 7 - weekday // Mon=6..Sat=1 days until Sunday
		}
	}

	dates := []string{}
	for i := 0; i <= days; i++ {
		d := today.AddDate(0, 0, i)
		dates = append(dates, d.Format("2006-01-02"))
	}
	return dates
}

// syncBookings reconciles kueue-sourced bookings with current usage.
// Slot indices are assigned globally per resource so that multiple namespaces
// get non-overlapping slots (e.g. ns1 gets 0,1 and ns2 gets 2,3,4).
func syncBookings(usages []resourceUsage, dates []string) error {
	type bookingKey struct {
		resource  string
		slotIndex int
		date      string
		slotType  string
	}
	desired := map[string]bookingKey{} // id -> key
	desiredMeta := map[string]string{} // id -> user

	// Group usages by resource, assign non-overlapping slot ranges
	type resGroup struct {
		usages []resourceUsage
	}
	byResource := map[string]*resGroup{}
	for _, u := range usages {
		g, ok := byResource[u.Resource]
		if !ok {
			g = &resGroup{}
			byResource[u.Resource] = g
		}
		g.usages = append(g.usages, u)
	}

	for _, group := range byResource {
		slotOffset := 0
		for _, u := range group.usages {
			for i := 0; i < u.Count; i++ {
				slotIdx := slotOffset + i
				for _, date := range dates {
					id := kueueBookingID(u.Namespace, u.Resource, slotIdx, date)
					desired[id] = bookingKey{
						resource:  u.Resource,
						slotIndex: slotIdx,
						date:      date,
						slotType:  "full",
					}
					desiredMeta[id] = u.User
				}
			}
			slotOffset += u.Count
		}
	}

	// Get existing kueue bookings
	rows, err := db.Query("SELECT id, resource, slot_index, date, slot_type FROM bookings WHERE source = 'consumed'")
	if err != nil {
		return fmt.Errorf("querying kueue bookings: %w", err)
	}
	defer rows.Close()

	existing := map[string]bool{}
	toRemove := []string{}

	today := time.Now().Format("2006-01-02")
	for rows.Next() {
		var id, resource, date, slotType string
		var slotIndex int
		if err := rows.Scan(&id, &resource, &slotIndex, &date, &slotType); err != nil {
			continue
		}
		existing[id] = true
		// Only remove stale bookings for today or future dates; keep past bookings as history
		if _, want := desired[id]; !want && date >= today {
			toRemove = append(toRemove, id)
		}
	}

	// Remove stale kueue bookings
	for _, id := range toRemove {
		_, err := db.Exec("DELETE FROM bookings WHERE id = ? AND source = 'consumed'", id)
		if err != nil {
			log.Printf("kueue sync: failed to remove booking %s: %v", id, err)
		}
	}
	if len(toRemove) > 0 {
		log.Printf("kueue sync: removed %d stale bookings", len(toRemove))
	}

	// Add missing kueue bookings
	added := 0
	skipped := 0
	for id, key := range desired {
		if existing[id] {
			continue
		}

		user := desiredMeta[id]
		createdAt := time.Now().UTC().Format(time.RFC3339)

		// Check if a manual booking already covers this slot
		var count int
		err := db.QueryRow(
			"SELECT COUNT(*) FROM bookings WHERE resource = ? AND slot_index = ? AND date = ? AND slot_type IN ('full', ?) AND source = 'reserved'",
			key.resource, key.slotIndex, key.date, key.slotType,
		).Scan(&count)
		if err != nil {
			log.Printf("kueue sync: conflict check failed for %s: %v", id, err)
			continue
		}
		if count > 0 {
			skipped++
			continue
		}

		_, err = db.Exec(
			"INSERT OR IGNORE INTO bookings (id, user, email, resource, slot_index, date, slot_type, created_at, source, description, start_hour, end_hour) VALUES (?, ?, '', ?, ?, ?, ?, ?, 'consumed', '', 0, 24)",
			id, user, key.resource, key.slotIndex, key.date, key.slotType, createdAt,
		)
		if err != nil {
			log.Printf("kueue sync: failed to insert booking %s: %v", id, err)
			continue
		}
		added++
	}

	if added > 0 || len(toRemove) > 0 {
		log.Printf("kueue sync: added=%d, removed=%d, skipped=%d (manual conflict), total_desired=%d",
			added, len(toRemove), skipped, len(desired))
	}

	return nil
}

func kueueBookingID(namespace, resource string, slotIndex int, date string) string {
	// Shorten resource name for cleaner IDs
	short := resource
	switch resource {
	case "nvidia.com/gpu":
		short = "gpu"
	case "nvidia.com/mig-3g.71gb":
		short = "mig3g"
	case "nvidia.com/mig-2g.35gb":
		short = "mig2g"
	case "nvidia.com/mig-1g.18gb":
		short = "mig1g"
	}
	return fmt.Sprintf("kueue-%s-%s-s%d-%s", namespace, short, slotIndex, date)
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

