import http.server
import socketserver
import urllib.request
import urllib.parse
import json
import sqlite3
import re
import os
import threading
import time
import csv
import datetime
import math

PORT = 8000
DB_FILE = "sponsors.db"
LOCK = threading.Lock()

def clean_value(val):
    if not val:
        return ""
    val = val.strip()
    # Remove leading/trailing quotes if they wrap the string
    if len(val) >= 2 and val[0] == '"' and val[-1] == '"':
        val = val[1:-1].strip()
    return val

def db_init():
    """Initializes the database schema and indexes."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # Create sponsors table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sponsors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organisation_name TEXT,
        town_city TEXT,
        county TEXT,
        rating TEXT,
        route TEXT,
        date_added TEXT,
        last_seen TEXT,
        status TEXT
    )
    """)
    
    # Create sync_history table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sync_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sync_date TEXT,
        csv_url TEXT,
        added_count INTEGER,
        removed_count INTEGER,
        total_sponsors INTEGER
    )
    """)
    
    # Create indexes for ultra-fast searches
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sponsors_name ON sponsors(organisation_name COLLATE NOCASE)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sponsors_city ON sponsors(town_city COLLATE NOCASE)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sponsors_route ON sponsors(route COLLATE NOCASE)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sponsors_rating ON sponsors(rating COLLATE NOCASE)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sponsors_status ON sponsors(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sponsors_date ON sponsors(date_added)")
    
    conn.commit()
    conn.close()
    print("[Database] Schema and indexes initialized successfully.")

def get_latest_csv_url():
    """Scrapes GOV.UK publication page to find the latest CSV download link."""
    url = "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers"
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as response:
            html = response.read().decode('utf-8')
        
        # Regex search for the Worker & Temporary Worker CSV file url
        matches = re.findall(r'href="([^"]+?Worker_and_Temporary_Worker\.csv)"', html)
        if not matches:
            # Fallback to general CSV download links
            matches = re.findall(r'href="([^"]+?\.csv)"', html)
            
        if matches:
            csv_url = matches[0]
            # Ensure full path if it's relative
            if csv_url.startswith('/'):
                csv_url = "https://www.gov.uk" + csv_url
            return csv_url
    except Exception as e:
        print(f"[Scraper] Error fetching GOV.UK page: {e}")
    return None

def run_sync():
    """Downloads the CSV and updates the SQLite database with incremental logic."""
    global LOCK
    with LOCK:
        db_init()
        print("[Sync] Checking for updates from GOV.UK...")
        csv_url = get_latest_csv_url()
        if not csv_url:
            print("[Sync] Failed to scrape CSV URL. Aborting.")
            return False
        
        # Check if we already synced this URL
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM sync_history WHERE csv_url = ?", (csv_url,))
        history_record = cursor.fetchone()
        
        # If already synced, skip downloading unless database is empty
        cursor.execute("SELECT COUNT(*) FROM sponsors")
        total_in_db = cursor.fetchone()[0]
        
        if history_record and total_in_db > 0:
            print(f"[Sync] CSV already synced ({csv_url}). Database is up to date.")
            conn.close()
            return True
            
        print(f"[Sync] Found new CSV URL: {csv_url}")
        print("[Sync] Downloading CSV file (approx 10.5 MB)...")
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        
        try:
            req = urllib.request.Request(csv_url, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as response:
                csv_data = response.read().decode('utf-8', errors='ignore')
            print("[Sync] Download complete. Processing CSV...")
        except Exception as e:
            print(f"[Sync] Download failed: {e}")
            conn.close()
            return False
            
        # Parse CSV lines
        reader = csv.reader(csv_data.splitlines())
        try:
            headers_row = next(reader)
        except StopIteration:
            print("[Sync] Empty CSV download. Aborting.")
            conn.close()
            return False
            
        # Standard headers: Organisation Name, Town/City, County, Type & Rating, Route
        # We will parse active sponsors from database to identify additions and deletions
        today_str = datetime.date.today().isoformat()
        
        # Load all currently active/newly added sponsors from DB to compute differences
        cursor.execute("SELECT id, organisation_name, town_city, route, status FROM sponsors WHERE status != 'Removed'")
        active_db_rows = cursor.fetchall()
        
        # Structure active dict: key=(name.lower(), city.lower(), route.lower()) -> (id, status)
        active_map = {}
        for db_id, name, city, route, status in active_db_rows:
            key = (clean_value(name).lower(), clean_value(city).lower(), clean_value(route).lower())
            active_map[key] = (db_id, status)
            
        added_count = 0
        preserved_ids = set() # Track what we saw in the CSV
        
        # Prepare sqlite statements
        insert_sql = """
        INSERT INTO sponsors (organisation_name, town_city, county, rating, route, date_added, last_seen, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Newly Added')
        """
        update_sql = """
        UPDATE sponsors SET last_seen = ?, status = ?, county = ?, rating = ? WHERE id = ?
        """
        
        rows_to_insert = []
        rows_to_update = []
        
        print("[Sync] Identifying incremental differences...")
        for row in reader:
            if not row or len(row) < 5:
                continue
                
            name = clean_value(row[0])
            city = clean_value(row[1])
            county = clean_value(row[2])
            rating = clean_value(row[3])
            route = clean_value(row[4])
            
            if not name:
                continue
                
            key = (name.lower(), city.lower(), route.lower())
            
            if key in active_map:
                db_id, current_status = active_map[key]
                # If was marked as removed, restore it to Active
                new_status = 'Active' if current_status == 'Active' else current_status
                rows_to_update.append((today_str, new_status, county, rating, db_id))
                preserved_ids.add(db_id)
            else:
                # Newly added sponsor!
                rows_to_insert.append((name, city, county, rating, route, today_str, today_str))
                added_count += 1
                
        # Bulk execute inserts and updates
        if rows_to_insert:
            cursor.executemany(insert_sql, rows_to_insert)
            
        if rows_to_update:
            cursor.executemany(update_sql, rows_to_update)
            
        # Find removed sponsors (active sponsors in DB that were NOT in the CSV)
        removed_ids = []
        for key, (db_id, _) in active_map.items():
            if db_id not in preserved_ids:
                removed_ids.append((db_id,))
                
        removed_count = len(removed_ids)
        if removed_ids:
            cursor.executemany("UPDATE sponsors SET status = 'Removed' WHERE id = ?", removed_ids)
            
        # Get total active sponsors after update
        cursor.execute("SELECT COUNT(*) FROM sponsors WHERE status != 'Removed'")
        total_sponsors = cursor.fetchone()[0]
        
        # Record sync history
        cursor.execute("""
        INSERT INTO sync_history (sync_date, csv_url, added_count, removed_count, total_sponsors)
        VALUES (?, ?, ?, ?, ?)
        """, (today_str, csv_url, added_count, removed_count, total_sponsors))
        
        conn.commit()
        conn.close()
        print(f"[Sync] Completed! Added: {added_count}, Removed: {removed_count}, Current Active Sponsors: {total_sponsors}")
        return True

def sync_daemon():
    """Background thread that runs sync daily."""
    print("[Sync Daemon] Thread started.")
    # Run sync on startup if db is empty
    db_init()
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM sponsors")
    count = cursor.fetchone()[0]
    conn.close()
    
    if count == 0:
        print("[Sync Daemon] Database is empty. Triggering initial sync...")
        run_sync()
        
    while True:
        # Sleep for 24 hours
        time.sleep(24 * 3600)
        print("[Sync Daemon] Running scheduled daily sync...")
        try:
            run_sync()
        except Exception as e:
            print(f"[Sync Daemon] Error during daily sync: {e}")


class CheckerAPIHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Override to prevent logging clutter in terminal unless requested
        pass
        
    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        if parsed_url.path == "/api/sync":
            print("[API] Manual sync triggered via POST request.")
            success = run_sync()
            self.send_response(200 if success else 500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            response = {"status": "success" if success else "failed"}
            self.wfile.write(json.dumps(response).encode('utf-8'))
        else:
            self.send_error(404, "Not Found")
            
    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query = urllib.parse.parse_qs(parsed_url.query)
        
        # CORS preflight / headers
        if path.startswith("/api/"):
            self.handle_api(path, query)
        else:
            self.handle_static(path)
            
    def handle_static(self, path):
        # Clean and route static file path
        if path == "/" or path == "/index.html":
            file_path = "index.html"
            content_type = "text/html; charset=utf-8"
        elif path == "/style.css":
            file_path = "style.css"
            content_type = "text/css; charset=utf-8"
        elif path == "/app.js":
            file_path = "app.js"
            content_type = "application/javascript; charset=utf-8"
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"File Not Found")
            return
            
        if not os.path.exists(file_path):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(f"File {file_path} not found. Please compile/create it.".encode('utf-8'))
            return
            
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.end_headers()
        
        with open(file_path, "rb") as f:
            self.wfile.write(f.read())
            
    def handle_api(self, path, query):
        conn = sqlite3.connect(DB_FILE)
        # Configure SQLite connection to return dictionary-like row structures
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        if path == "/api/sponsors":
            # Extract filters and search queries
            q = query.get("q", [""])[0].strip()
            city = query.get("city", [""])[0].strip()
            route = query.get("route", [""])[0].strip()
            rating = query.get("rating", [""])[0].strip()
            status = query.get("status", [""])[0].strip()
            
            # Pagination
            try:
                page = int(query.get("page", ["1"])[0])
            except ValueError:
                page = 1
            try:
                limit = int(query.get("limit", ["20"])[0])
            except ValueError:
                limit = 20
            limit = min(max(1, limit), 100) # Clamp limit between 1 and 100
            offset = (page - 1) * limit
            
            # Sorting
            sort_by = query.get("sort_by", ["organisation_name"])[0].strip()
            sort_dir = query.get("sort_dir", ["asc"])[0].strip().lower()
            
            allowed_sorts = {
                "organisation_name": "organisation_name",
                "town_city": "town_city",
                "route": "route",
                "date_added": "date_added",
                "rating": "rating"
            }
            sort_col = allowed_sorts.get(sort_by, "organisation_name")
            sort_order = "DESC" if sort_dir == "desc" else "ASC"
            
            # Build query
            conditions = []
            params = []
            
            if q:
                conditions.append("organisation_name LIKE ?")
                params.append(f"%{q}%")
            if city:
                conditions.append("town_city = ?")
                params.append(city)
            if route:
                conditions.append("route = ?")
                params.append(route)
            if rating:
                conditions.append("rating = ?")
                params.append(rating)
            if status:
                conditions.append("status = ?")
                params.append(status)
            else:
                # Default filter: skip Removed sponsors unless requested
                conditions.append("status != 'Removed'")
                
            where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""
            
            # Get total matching records
            count_sql = f"SELECT COUNT(*) FROM sponsors {where_clause}"
            cursor.execute(count_sql, params)
            total = cursor.fetchone()[0]
            
            # Get paginated records
            data_sql = f"""
            SELECT * FROM sponsors 
            {where_clause} 
            ORDER BY {sort_col} COLLATE NOCASE {sort_order}
            LIMIT ? OFFSET ?
            """
            cursor.execute(data_sql, params + [limit, offset])
            rows = cursor.fetchall()
            
            # Convert SQLite Rows to Dict List
            sponsors = []
            for r in rows:
                sponsors.append(dict(r))
                
            response = {
                "sponsors": sponsors,
                "meta": {
                    "total": total,
                    "page": page,
                    "limit": limit,
                    "pages": math.ceil(total / limit) if total > 0 else 0
                }
            }
            
            self.send_json(response)
            
        elif path == "/api/filters":
            # Fetch dropdown options and autofills
            # Top 50 towns/cities with most sponsors (excluding removed)
            cursor.execute("""
            SELECT UPPER(town_city) as town_city, COUNT(*) as count 
            FROM sponsors 
            WHERE status != 'Removed' AND town_city != ''
            GROUP BY UPPER(town_city) 
            ORDER BY count DESC 
            LIMIT 50
            """)
            top_cities = []
            for r in cursor.fetchall():
                top_cities.append({
                    "town_city": r["town_city"].title(),
                    "count": r["count"]
                })
            
            # Distinct routes
            cursor.execute("SELECT DISTINCT route FROM sponsors WHERE status != 'Removed' AND route != '' ORDER BY route ASC")
            routes = [r[0] for r in cursor.fetchall()]
            
            # Distinct ratings
            cursor.execute("SELECT DISTINCT rating FROM sponsors WHERE status != 'Removed' AND rating != '' ORDER BY rating ASC")
            ratings = [r[0] for r in cursor.fetchall()]
            
            response = {
                "top_cities": top_cities,
                "routes": routes,
                "ratings": ratings
            }
            self.send_json(response)
            
        elif path == "/api/stats":
            # Aggregate totals
            cursor.execute("SELECT COUNT(*) FROM sponsors WHERE status != 'Removed'")
            total_active = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM sponsors WHERE status = 'Newly Added'")
            newly_added = cursor.fetchone()[0]
            
            cursor.execute("SELECT COUNT(*) FROM sponsors WHERE status = 'Removed'")
            total_removed = cursor.fetchone()[0]
            
            # Route splits
            cursor.execute("""
            SELECT route, COUNT(*) as count 
            FROM sponsors 
            WHERE status != 'Removed'
            GROUP BY route 
            ORDER BY count DESC 
            LIMIT 6
            """)
            routes_dist = [dict(r) for r in cursor.fetchall()]
            
            # Rating splits
            cursor.execute("""
            SELECT rating, COUNT(*) as count 
            FROM sponsors 
            WHERE status != 'Removed'
            GROUP BY rating 
            ORDER BY count DESC
            """)
            ratings_dist = [dict(r) for r in cursor.fetchall()]
            
            # City distribution
            cursor.execute("""
            SELECT UPPER(town_city) as town_city, COUNT(*) as count 
            FROM sponsors 
            WHERE status != 'Removed' AND town_city != ''
            GROUP BY UPPER(town_city) 
            ORDER BY count DESC 
            LIMIT 8
            """)
            cities_dist = []
            for r in cursor.fetchall():
                cities_dist.append({
                    "town_city": r["town_city"].title(),
                    "count": r["count"]
                })
            
            # Sync logs
            cursor.execute("SELECT * FROM sync_history ORDER BY id DESC LIMIT 1")
            sync_row = cursor.fetchone()
            latest_sync = dict(sync_row) if sync_row else None
            
            response = {
                "total_active": total_active,
                "newly_added": newly_added,
                "total_removed": total_removed,
                "routes_distribution": routes_dist,
                "ratings_distribution": ratings_dist,
                "cities_distribution": cities_dist,
                "latest_sync": latest_sync
            }
            self.send_json(response)
            
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"API Endpoint Not Found")
            
        conn.close()
        
    def send_json(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

def main():
    # Start the daemon background sync thread
    sync_thread = threading.Thread(target=sync_daemon, daemon=True)
    sync_thread.start()
    
    # Launch server
    handler = CheckerAPIHandler
    # Enable socket reuse to prevent port-lock delays
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer(("", PORT), handler) as httpd:
        print("==================================================")
        print(f" UK SPONSORSHIP LICENCE CHECKER SERVER IS RUNNING ")
        print(f" Address: http://localhost:{PORT}                 ")
        print("==================================================")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")

if __name__ == "__main__":
    main()
