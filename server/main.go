package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

var (
	adminPassword string
	adminSecret   []byte // random key for signing admin tokens
	devUser       string // fallback user identity for local dev (no OAuth proxy)
)

type GPUResource struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	Count     int    `json:"count"`
	Available int    `json:"available"`
}

type Booking struct {
	ID          string `json:"id"`
	User        string `json:"user"`
	Email       string `json:"email"`
	Resource    string `json:"resource"`
	SlotIndex   int    `json:"slotIndex"`
	Date        string `json:"date"`
	SlotType    string `json:"slotType"`
	CreatedAt   string `json:"createdAt"`
	Source      string `json:"source"`
	Description string `json:"description"`
	StartHour   int    `json:"startHour"`
	EndHour     int    `json:"endHour"`
}

type BookingRequest struct {
	Resource    string `json:"resource"`
	SlotIndex   int    `json:"slotIndex"`
	Date        string `json:"date"`
	SlotType    string `json:"slotType"`
	Description string `json:"description"`
	StartHour   int    `json:"startHour"`
	EndHour     int    `json:"endHour"`
}

type BulkBookingRequest struct {
	Resources   map[string]int `json:"resources"`   // resource type -> count
	StartDate   string         `json:"startDate"`
	EndDate     string         `json:"endDate"`
	Description string         `json:"description"`
	StartHour   int            `json:"startHour"` // UTC hour 0-23
	EndHour     int            `json:"endHour"`   // UTC hour 1-24 (24 = midnight next day)
}

type Config struct {
	Resources         []GPUResource `json:"resources"`
	BookingWindowDays int           `json:"bookingWindowDays"`
}

var (
	db                *sql.DB
	bookingWindowDays int
)

func getConfig() Config {
	return Config{
		Resources: []GPUResource{
			{Name: "H200 Full GPU", Type: "nvidia.com/gpu", Count: 8, Available: 8},
			{Name: "MIG 3g.71gb", Type: "nvidia.com/mig-3g.71gb", Count: 8, Available: 8},
			{Name: "MIG 2g.35gb", Type: "nvidia.com/mig-2g.35gb", Count: 8, Available: 8},
			{Name: "MIG 1g.18gb", Type: "nvidia.com/mig-1g.18gb", Count: 16, Available: 16},
		},
		BookingWindowDays: bookingWindowDays,
	}
}

func initDB(dbPath string) error {
	var err error
	db, err = sql.Open("sqlite3", dbPath+"?_journal_mode=WAL")
	if err != nil {
		return fmt.Errorf("opening database: %w", err)
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS bookings (
			id TEXT PRIMARY KEY,
			user TEXT NOT NULL,
			email TEXT NOT NULL DEFAULT '',
			resource TEXT NOT NULL,
			slot_index INTEGER NOT NULL,
			date TEXT NOT NULL,
			slot_type TEXT NOT NULL,
			created_at TEXT NOT NULL,
			source TEXT NOT NULL DEFAULT 'reserved',
			description TEXT NOT NULL DEFAULT '',
			start_hour INTEGER NOT NULL DEFAULT 0,
			end_hour INTEGER NOT NULL DEFAULT 24,
			UNIQUE(resource, slot_index, date, slot_type)
		)
	`)
	if err != nil {
		return fmt.Errorf("creating table: %w", err)
	}

	// Migrations: add columns if missing (existing databases)
	_, _ = db.Exec("ALTER TABLE bookings ADD COLUMN source TEXT NOT NULL DEFAULT 'reserved'")
	_, _ = db.Exec("ALTER TABLE bookings ADD COLUMN description TEXT NOT NULL DEFAULT ''")
	_, _ = db.Exec("ALTER TABLE bookings ADD COLUMN start_hour INTEGER NOT NULL DEFAULT 0")
	_, _ = db.Exec("ALTER TABLE bookings ADD COLUMN end_hour INTEGER NOT NULL DEFAULT 24")

	return nil
}

func configHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(getConfig())
}

func bookingsHandler(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		getBookings(w, r)
	case http.MethodPost:
		createBooking(w, r)
	case http.MethodDelete:
		deleteBooking(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func getBookings(w http.ResponseWriter, r *http.Request) {
	user := requestUser(r)
	rows, err := db.Query("SELECT id, user, email, resource, slot_index, date, slot_type, created_at, source, description, start_hour, end_hour FROM bookings ORDER BY date, slot_type")
	if err != nil {
		http.Error(w, `{"error":"database_error"}`, http.StatusInternalServerError)
		log.Printf("error querying bookings: %v", err)
		return
	}
	defer rows.Close()

	bookings := []Booking{}
	for rows.Next() {
		var b Booking
		if err := rows.Scan(&b.ID, &b.User, &b.Email, &b.Resource, &b.SlotIndex, &b.Date, &b.SlotType, &b.CreatedAt, &b.Source, &b.Description, &b.StartHour, &b.EndHour); err != nil {
			log.Printf("error scanning booking: %v", err)
			continue
		}
		bookings = append(bookings, b)
	}

	// Build active reservations map: user -> clusterqueue name
	activeRes := map[string]string{}
	today := time.Now().Format("2006-01-02")
	for _, b := range bookings {
		if b.Source == "reserved" && b.Date == today {
			if _, ok := activeRes[b.User]; !ok {
				activeRes[b.User] = "user-" + b.User
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"bookings":           bookings,
		"activeReservations": activeRes,
		"currentUser":        user,
	})
}

// requestUser returns the authenticated user from the OAuth proxy header,
// falling back to DEV_USER env var for local development.
func requestUser(r *http.Request) string {
	if user := r.Header.Get("X-Forwarded-User"); user != "" {
		return user
	}
	if devUser != "" {
		return devUser
	}
	return "anonymous"
}

func createBooking(w http.ResponseWriter, r *http.Request) {
	user := requestUser(r)
	email := r.Header.Get("X-Forwarded-Email")

	var req BookingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
		return
	}

	if req.SlotType != "full" {
		http.Error(w, `{"error":"invalid_slot_type"}`, http.StatusBadRequest)
		return
	}

	// Check for conflicts on the same resource+unit+date
	rows, err := db.Query(
		"SELECT id, source FROM bookings WHERE resource = ? AND slot_index = ? AND date = ?",
		req.Resource, req.SlotIndex, req.Date,
	)
	if err != nil {
		http.Error(w, `{"error":"database_error"}`, http.StatusInternalServerError)
		log.Printf("error checking conflicts: %v", err)
		return
	}
	var conflictIDs []string
	hasReservedConflict := false
	for rows.Next() {
		var cID, cSource string
		if err := rows.Scan(&cID, &cSource); err != nil {
			continue
		}
		if cSource == "reserved" {
			hasReservedConflict = true
		}
		conflictIDs = append(conflictIDs, cID)
	}
	rows.Close()

	if hasReservedConflict {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "slot_taken"})
		return
	}

	// Evict consumed bookings that conflict with this reservation
	for _, cID := range conflictIDs {
		if _, err := db.Exec("DELETE FROM bookings WHERE id = ?", cID); err != nil {
			log.Printf("error evicting consumed booking %s: %v", cID, err)
		} else {
			log.Printf("evicted consumed booking %s for reservation by %s", cID, user)
		}
	}

	id := fmt.Sprintf("booking-%d", time.Now().UnixNano())
	createdAt := time.Now().UTC().Format(time.RFC3339)

	desc := req.Description
	if len(desc) > 160 {
		desc = desc[:160]
	}

	startHour := req.StartHour
	endHour := req.EndHour
	if startHour < 0 || startHour > 23 {
		startHour = 0
	}
	if endHour < 1 || endHour > 24 {
		endHour = 24
	}

	_, err = db.Exec(
		"INSERT INTO bookings (id, user, email, resource, slot_index, date, slot_type, created_at, source, description, start_hour, end_hour) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)",
		id, user, email, req.Resource, req.SlotIndex, req.Date, req.SlotType, createdAt, desc, startHour, endHour,
	)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "slot_taken"})
		return
	}

	booking := Booking{
		ID:          id,
		User:        user,
		Email:       email,
		Resource:    req.Resource,
		SlotIndex:   req.SlotIndex,
		Date:        req.Date,
		SlotType:    req.SlotType,
		CreatedAt:   createdAt,
		Source:      "reserved",
		Description: desc,
		StartHour:   startHour,
		EndHour:     endHour,
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(booking)

	go syncReservations()
}

func deleteBooking(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, `{"error":"missing_id"}`, http.StatusBadRequest)
		return
	}

	user := requestUser(r)

	// Check ownership and source
	var owner, source string
	err := db.QueryRow("SELECT user, source FROM bookings WHERE id = ?", id).Scan(&owner, &source)
	if err == sql.ErrNoRows {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, `{"error":"database_error"}`, http.StatusInternalServerError)
		return
	}

	// Consumed bookings cannot be cancelled by normal users
	if source == "consumed" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{"error": "consumed_booking"})
		return
	}

	if owner != user && user != "admin" {
		http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
		return
	}

	_, err = db.Exec("DELETE FROM bookings WHERE id = ?", id)
	if err != nil {
		http.Error(w, `{"error":"database_error"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})

	go syncReservations()
}

func generateAdminToken() string {
	ts := fmt.Sprintf("%d", time.Now().Unix())
	mac := hmac.New(sha256.New, adminSecret)
	mac.Write([]byte(ts))
	sig := hex.EncodeToString(mac.Sum(nil))
	return ts + "." + sig
}

func verifyAdminToken(token string) bool {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return false
	}
	mac := hmac.New(sha256.New, adminSecret)
	mac.Write([]byte(parts[0]))
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(parts[1]), []byte(expected))
}

func adminLoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
		return
	}

	if adminPassword == "" || req.Password != adminPassword {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid_password"})
		return
	}

	token := generateAdminToken()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": token})
}

func adminHandler(w http.ResponseWriter, r *http.Request) {
	// Verify admin token
	auth := r.Header.Get("Authorization")
	token := strings.TrimPrefix(auth, "Bearer ")
	if token == "" || !verifyAdminToken(token) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
		return
	}

	switch r.Method {
	case http.MethodDelete:
		adminDeleteBooking(w, r)
	default:
		adminListBookings(w, r)
	}
}

func adminDeleteBooking(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")

	// Delete all bookings when no id is provided
	if id == "" {
		result, err := db.Exec("DELETE FROM bookings")
		if err != nil {
			http.Error(w, `{"error":"database_error"}`, http.StatusInternalServerError)
			return
		}
		rows, _ := result.RowsAffected()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"status": "deleted", "count": rows})
		go syncReservations()
		return
	}

	result, err := db.Exec("DELETE FROM bookings WHERE id = ?", id)
	if err != nil {
		http.Error(w, `{"error":"database_error"}`, http.StatusInternalServerError)
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		http.Error(w, `{"error":"not_found"}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
	go syncReservations()
}

func adminListBookings(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, user, email, resource, slot_index, date, slot_type, created_at, source, description, start_hour, end_hour FROM bookings ORDER BY date, slot_type")
	if err != nil {
		http.Error(w, `{"error":"database_error"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	bookings := []Booking{}
	for rows.Next() {
		var b Booking
		if err := rows.Scan(&b.ID, &b.User, &b.Email, &b.Resource, &b.SlotIndex, &b.Date, &b.SlotType, &b.CreatedAt, &b.Source, &b.Description, &b.StartHour, &b.EndHour); err != nil {
			continue
		}
		bookings = append(bookings, b)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"bookings":               bookings,
		"config":                 getConfig(),
		"totalSlots":             40,
		"reservationSyncEnabled": reservationSyncEnabled,
	})
}

func adminReservationToggleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	auth := r.Header.Get("Authorization")
	token := strings.TrimPrefix(auth, "Bearer ")
	if token == "" || !verifyAdminToken(token) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
		return
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
		return
	}

	reservationSyncEnabled = req.Enabled
	log.Printf("admin: reservation sync set to enabled=%v", req.Enabled)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"reservationSyncEnabled": reservationSyncEnabled})
}

func bulkBookingHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	user := requestUser(r)
	email := r.Header.Get("X-Forwarded-Email")

	var req BulkBookingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid_request"}`, http.StatusBadRequest)
		return
	}

	if req.StartDate == "" || req.EndDate == "" || len(req.Resources) == 0 {
		http.Error(w, `{"error":"missing_fields"}`, http.StatusBadRequest)
		return
	}

	if req.StartDate > req.EndDate {
		http.Error(w, `{"error":"invalid_date_range"}`, http.StatusBadRequest)
		return
	}

	desc := req.Description
	if len(desc) > 160 {
		desc = desc[:160]
	}

	startHour := req.StartHour
	endHour := req.EndHour
	if startHour < 0 || startHour > 23 {
		startHour = 0
	}
	if endHour < 1 || endHour > 24 {
		endHour = 24
	}

	// Generate date range
	start, err := time.Parse("2006-01-02", req.StartDate)
	if err != nil {
		http.Error(w, `{"error":"invalid_start_date"}`, http.StatusBadRequest)
		return
	}
	end, err := time.Parse("2006-01-02", req.EndDate)
	if err != nil {
		http.Error(w, `{"error":"invalid_end_date"}`, http.StatusBadRequest)
		return
	}

	var dates []string
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		dates = append(dates, d.Format("2006-01-02"))
	}

	var created []Booking
	var errors []string

	for resource, count := range req.Resources {
		if count <= 0 {
			continue
		}
		for _, date := range dates {
			// Find reserved (blocking) and consumed (evictable) slot indices
			slotRows, err := db.Query(
				"SELECT slot_index, source, id FROM bookings WHERE resource = ? AND date = ?",
				resource, date,
			)
			if err != nil {
				errors = append(errors, fmt.Sprintf("%s on %s: database error", resource, date))
				continue
			}
			reserved := map[int]bool{}
			consumedIDs := map[int]string{} // slot_index -> booking ID (evictable)
			for slotRows.Next() {
				var idx int
				var src, bid string
				if err := slotRows.Scan(&idx, &src, &bid); err == nil {
					if src == "reserved" {
						reserved[idx] = true
					} else {
						consumedIDs[idx] = bid
					}
				}
			}
			slotRows.Close()

			// Find max unit count for this resource
			maxUnits := 0
			for _, gr := range getConfig().Resources {
				if gr.Type == resource {
					maxUnits = gr.Count
					break
				}
			}
			if maxUnits == 0 {
				errors = append(errors, fmt.Sprintf("%s: unknown resource type", resource))
				continue
			}

			booked := 0
			for unitIdx := 0; unitIdx < maxUnits && booked < count; unitIdx++ {
				if reserved[unitIdx] {
					continue
				}
				// Evict consumed booking if present
				if cID, ok := consumedIDs[unitIdx]; ok {
					if _, err := db.Exec("DELETE FROM bookings WHERE id = ?", cID); err != nil {
						log.Printf("bulk booking: error evicting consumed booking %s: %v", cID, err)
						continue
					}
					log.Printf("bulk booking: evicted consumed booking %s for reservation by %s", cID, user)
				}

				id := fmt.Sprintf("booking-%d", time.Now().UnixNano())
				createdAt := time.Now().UTC().Format(time.RFC3339)

				_, err := db.Exec(
					"INSERT INTO bookings (id, user, email, resource, slot_index, date, slot_type, created_at, source, description, start_hour, end_hour) VALUES (?, ?, ?, ?, ?, ?, 'full', ?, 'reserved', ?, ?, ?)",
					id, user, email, resource, unitIdx, date, createdAt, desc, startHour, endHour,
				)
				if err != nil {
					log.Printf("bulk booking: insert failed for %s unit %d on %s: %v", resource, unitIdx, date, err)
					continue
				}

				created = append(created, Booking{
					ID:          id,
					User:        user,
					Email:       email,
					Resource:    resource,
					SlotIndex:   unitIdx,
					Date:        date,
					SlotType:    "full",
					CreatedAt:   createdAt,
					Source:      "reserved",
					Description: desc,
					StartHour:   startHour,
					EndHour:     endHour,
				})
				booked++
			}
			if booked < count {
				errors = append(errors, fmt.Sprintf("%s on %s: only %d of %d slots available", resource, date, booked, count))
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	if len(created) == 0 && len(errors) > 0 {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]any{"error": "no_slots_available", "details": errors})
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{
		"bookings": created,
		"errors":   errors,
	})

	if len(created) > 0 {
		go syncReservations()
	}
}

func main() {
	port := flag.String("port", "", "server port")
	dbPath := flag.String("db", "", "sqlite database path")
	flag.Parse()

	if *port == "" {
		if p := os.Getenv("PORT"); p != "" {
			*port = p
		} else {
			*port = "8080"
		}
	}

	if *dbPath == "" {
		if p := os.Getenv("DB_PATH"); p != "" {
			*dbPath = p
		} else {
			*dbPath = "./bookings.db"
		}
	}

	adminPassword = os.Getenv("ADMIN_PASSWORD")
	if adminPassword == "" {
		adminPassword = "admin" // default for local dev
	}

	devUser = os.Getenv("DEV_USER")
	if devUser != "" {
		log.Printf("dev mode: using DEV_USER=%s as default identity", devUser)
	}

	bookingWindowDays = 30 // default 1 month
	if bw := os.Getenv("BOOKING_WINDOW_DAYS"); bw != "" {
		if n, err := strconv.Atoi(bw); err == nil && n > 0 {
			bookingWindowDays = n
		}
	}

	// Kueue sync configuration
	kueueSyncEnabled = os.Getenv("KUEUE_SYNC_ENABLED") == "true"
	kueueSyncInterval = 60 // default 60 seconds
	if v := os.Getenv("KUEUE_SYNC_INTERVAL"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			kueueSyncInterval = n
		}
	}
	kueueBookingDays = 0 // default: rest of current week
	if v := os.Getenv("KUEUE_BOOKING_DAYS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			kueueBookingDays = n
		}
	}

	adminSecret = make([]byte, 32)
	if _, err := rand.Read(adminSecret); err != nil {
		log.Fatalf("failed to generate admin secret: %v", err)
	}

	if err := initDB(*dbPath); err != nil {
		log.Fatalf("failed to initialize database: %v", err)
	}
	defer db.Close()
	log.Printf("database initialized at %s", *dbPath)

	initK8sClient()
	initKueueSync()
	initReservationSync()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/config", configHandler)
	mux.HandleFunc("/api/bookings/bulk", bulkBookingHandler)
	mux.HandleFunc("/api/bookings", bookingsHandler)
	mux.HandleFunc("/api/admin/login", adminLoginHandler)
	mux.HandleFunc("/api/admin/reservations", adminReservationToggleHandler)
	mux.HandleFunc("/api/admin", adminHandler)

	addr := fmt.Sprintf(":%s", *port)
	log.Printf("booking-app server starting on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
