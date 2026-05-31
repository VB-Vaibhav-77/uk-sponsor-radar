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
import concurrent.futures

PORT = 8000
DB_FILE = "jobs.db"
LOCK = threading.Lock()

# Verified Premium Visa Sponsors ATS Board Mappings (tenant/token mappings)
PRESEED_ATS_MAPPINGS = [
    ("Lloyds Banking Group", "workday", "lbg", "LBG_Careers"),
    ("Barclays", "workday", "barclays", "Barclays_Careers"),
    ("PricewaterhouseCoopers", "workday", "pwc", "PwC_Careers"),
    ("Monzo Bank", "greenhouse", "monzo", "monzo"),
    ("Deliveroo", "greenhouse", "deliveroo", "deliveroo"),
    ("Revolut", "lever", "revolut", "revolut"),
    ("Wise", "greenhouse", "transferwise", "transferwise"),
    ("Starling Bank", "greenhouse", "starlingbank", "starlingbank"),
    ("Snyk", "greenhouse", "snyk", "snyk"),
    ("Checkout.com", "greenhouse", "checkout", "checkout"),
    ("Improbable", "greenhouse", "improbable", "improbable"),
    ("Skyscanner", "greenhouse", "skyscanner", "skyscanner"),
    ("Gousto", "greenhouse", "gousto", "gousto"),
    ("Gymshark", "greenhouse", "gymshark", "gymshark"),
    ("Curve", "greenhouse", "curve", "curve"),
    ("Cleo", "greenhouse", "cleo", "cleo"),
    ("Octopus Energy", "greenhouse", "octopusenergy", "octopusenergy"),
    ("DeepMind", "greenhouse", "deepmind", "deepmind"),
    ("Graphcore", "greenhouse", "graphcore", "graphcore"),
    ("TrueLayer", "greenhouse", "truelayer", "truelayer"),
    ("Zego", "greenhouse", "zego", "zego"),
    ("Marshmallow", "greenhouse", "marshmallow", "marshmallow"),
    ("Farewill", "greenhouse", "farewill", "farewill"),
    ("Bloom & Wild", "greenhouse", "bloomandwild", "bloomandwild"),
    ("Paddle", "greenhouse", "paddle", "paddle"),
    ("Motorway", "greenhouse", "motorway", "motorway"),
    ("Depop", "greenhouse", "depop", "depop"),
    ("Lyst", "greenhouse", "lyst", "lyst"),
    ("Trainline", "greenhouse", "trainline", "trainline"),
    ("Zilch", "greenhouse", "zilch", "zilch"),
    ("Thought Machine", "greenhouse", "thoughtmachine", "thoughtmachine"),
    ("PrimaryBid", "greenhouse", "primarybid", "primarybid"),
    ("Wayve", "greenhouse", "wayve", "wayve"),
    ("Synthesia", "greenhouse", "synthesia", "synthesia"),
    ("Onfido", "greenhouse", "onfido", "onfido"),
    ("ComplyAdvantage", "greenhouse", "complyadvantage", "complyadvantage"),
    ("Multiverse", "greenhouse", "multiverse", "multiverse"),
    ("Snowplow", "greenhouse", "snowplow", "snowplow"),
    ("Faculty", "greenhouse", "faculty", "faculty"),
    ("Signal AI", "greenhouse", "signalai", "signalai"),
    ("Healx", "greenhouse", "healx", "healx"),
    ("BrewDog", "greenhouse", "brewdog", "brewdog")
]

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
    
    # 1. Create sponsors table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sponsors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organisation_name TEXT,
        town_city TEXT,
        county TEXT,
        rating TEXT,
        route TEXT,
        website_url TEXT,
        careers_url TEXT,
        status TEXT,
        date_added TEXT,
        last_seen TEXT
    )
    """)
    
    # 2. Create sync_history table
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
    
    # 3. Create jobs table with description column
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sponsor_id INTEGER,
        company_name TEXT,
        job_title TEXT,
        department TEXT,
        location TEXT,
        job_url TEXT,
        posted_date TEXT,
        source TEXT,
        raw_id TEXT UNIQUE,
        description TEXT,
        FOREIGN KEY(sponsor_id) REFERENCES sponsors(id) ON DELETE SET NULL
    )
    """)
    
    # 4. Create sponsor_ats_mappings table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sponsor_ats_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT UNIQUE,
        ats_type TEXT,
        ats_tenant TEXT,
        ats_token TEXT
    )
    """)
    
    # Check if 'description' column exists in existing database (Automatic Migration)
    try:
        cursor.execute("PRAGMA table_info(jobs)")
        columns = [col[1] for col in cursor.fetchall()]
        if columns and "description" not in columns:
            print("[Database] Migrating database: adding 'description' column to 'jobs' table...")
            cursor.execute("ALTER TABLE jobs ADD COLUMN description TEXT")
    except Exception as e:
        print(f"[Database] Migration check failed: {e}")
    
    # Create indexes for ultra-fast searches
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sponsors_name ON sponsors(organisation_name COLLATE NOCASE)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sponsors_city ON sponsors(town_city COLLATE NOCASE)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sponsors_route ON sponsors(route COLLATE NOCASE)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sponsors_rating ON sponsors(rating COLLATE NOCASE)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sponsors_status ON sponsors(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sponsors_date ON sponsors(date_added)")
    
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_jobs_title ON jobs(job_title COLLATE NOCASE)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_jobs_dept ON jobs(department COLLATE NOCASE)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_jobs_loc ON jobs(location COLLATE NOCASE)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_name)")
    
    # Pre-seed premium mappings
    for name, ats_type, tenant, token in PRESEED_ATS_MAPPINGS:
        try:
            cursor.execute("""
            INSERT OR IGNORE INTO sponsor_ats_mappings (company_name, ats_type, ats_tenant, ats_token)
            VALUES (?, ?, ?, ?)
            """, (name, ats_type, tenant, token))
        except Exception:
            pass
            
    conn.commit()
    conn.close()
    print("[Database] Schema and indexes initialized successfully.")
    cleanup_non_uk_jobs()

def is_uk_location(location, title=""):
    if not location:
        return True
        
    loc_lower = location.lower()
    title_lower = title.lower() if title else ""
    
    # Protect Northern Ireland from triggering Ireland
    loc_lower = loc_lower.replace("northern ireland", "northern_ireland_protected")
    title_lower = title_lower.replace("northern ireland", "northern_ireland_protected")
    
    non_uk_terms = [
        "usa", "united states", "us", "america", "canada", "toronto", "vancouver", "montreal",
        "india", "bangalore", "mumbai", "delhi", "hyderabad", "chennai", "germany", "berlin",
        "munich", "frankfurt", "france", "paris", "spain", "barcelona", "madrid", "italy",
        "rome", "milan", "netherlands", "amsterdam", "australia", "sydney", "melbourne",
        "brisbane", "singapore", "tokyo", "japan", "china", "beijing", "shanghai", "hong kong",
        "dublin", "ireland", "belgium", "brussels", "switzerland", "zurich", "geneva",
        "sweden", "stockholm", "poland", "warsaw", "krakow", "austria", "vienna", "mexico",
        "brazil", "sao paulo", "rio", "south africa", "johannesburg", "cape town", "new zealand",
        "auckland", "portugal", "lisbon", "finland", "helsinki", "norway", "oslo", "denmark",
        "copenhagen", "sunnyvale", "austin", "texas", "california", "new york", "san francisco",
        "chicago", "boston", "seattle", "ny", "sf", "ca", "tx", "wa", "ma", "il", "co", "denver",
        "taiwan", "romania", "czech republic", "prague", "shenzhen", "detroit", "israel", 
        "milpitas", "miami", "cluj", "cluj-napoca", "hsinchu", "pune", "bengaluru", "noida", 
        "gurgaon", "gurugram", "cork", "galway", "lyon", "marseille", "hamburg", "rotterdam",
        "porto", "milan", "atlanta", "dallas", "los angeles"
    ]
    
    for term in non_uk_terms:
        pattern = r'\b' + re.escape(term) + r'\b'
        if re.search(pattern, loc_lower) or re.search(pattern, title_lower):
            has_uk = any(re.search(r'\b' + re.escape(u) + r'\b', loc_lower) for u in ["united kingdom", "london", "uk", "gb", "england", "scotland", "wales", "northern_ireland_protected"])
            if not has_uk:
                return False
                
    uk_positive = ["united kingdom", "uk", "gb", "england", "scotland", "wales", "northern_ireland_protected", "london", "manchester", "birmingham", "leeds", "glasgow", "edinburgh", "bristol", "cardiff", "belfast", "remote (uk)", "remote uk"]
    if any(re.search(r'\b' + re.escape(u) + r'\b', loc_lower) for u in uk_positive):
        return True
        
    if any(w in loc_lower for w in ["remote", "flexible", "hybrid", "office"]):
        return True
        
    return True


def cleanup_non_uk_jobs():
    """Removes all non-UK jobs from the database immediately to keep jobs board strictly UK."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id, job_title, location, company_name FROM jobs")
        rows = cursor.fetchall()
        to_delete = []
        for r_id, title, loc, company in rows:
            if not is_uk_location(loc, title):
                to_delete.append((r_id,))
        if to_delete:
            print(f"[Cleanup] Removing {len(to_delete)} non-UK jobs from database...")
            cursor.executemany("DELETE FROM jobs WHERE id = ?", to_delete)
            conn.commit()
    except Exception as e:
        print(f"[Cleanup] Error removing non-UK jobs: {e}")
    finally:
        conn.close()

# ---------------------------------------------------------------------------
# AUTOMATED BRAND & CAREER URL DISCOVERY
# ---------------------------------------------------------------------------

def clean_company_name_for_suggest(name):
    """Strips complex corporate suffixes to yield perfect brand queries for autocomplete search."""
    name_clean = re.sub(r'\b(ltd|limited|plc|uk|co|group|holdings|services|bank|corporation|corp|llp|lp|assoc|intl|international)\b', '', name, flags=re.IGNORECASE)
    name_clean = re.sub(r'[^a-zA-Z0-9\s]', '', name_clean)
    name_clean = re.sub(r'\s+', ' ', name_clean).strip()
    
    words = name_clean.split()
    if words:
        if len(words[0]) <= 2 and len(words) > 1:
            return f"{words[0]} {words[1]}"
        return words[0]
    return name

def auto_discover_careers_url(company_name, city):
    """Autocomplete Resolver: searches Clearbit, extracts official domain, and probes careers path candidates in parallel."""
    import concurrent.futures
    query = clean_company_name_for_suggest(company_name)
    url = f"https://autocomplete.clearbit.com/v1/companies/suggest?query={urllib.parse.quote(query)}"
    
    # Premium browser headers to bypass WAF blocks
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
    }
    
    domain = ""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': headers['User-Agent']})
        with urllib.request.urlopen(req, timeout=6) as response:
            data = json.loads(response.read().decode('utf-8'))
        
        if data:
            # 1. Try exact case-insensitive match first (guarantees EY matching ey.com and Softcat matching softcat.com!)
            for match in data:
                m_name = match.get("name", "").strip().lower()
                m_domain = match.get("domain", "")
                if m_name == query.lower() and m_domain:
                    domain = m_domain
                    break
            
            # 2. Try word-boundary matching (e.g. "thought" matches "thought machine")
            if not domain:
                for match in data:
                    m_name = match.get("name", "").strip().lower()
                    m_domain = match.get("domain", "")
                    if re.search(r'\b' + re.escape(query.lower()) + r'\b', m_name) and m_domain:
                        domain = m_domain
                        break
            
            # 3. Fallback to substring matching
            if not domain:
                for match in data:
                    m_name = match.get("name", "").strip().lower()
                    m_domain = match.get("domain", "")
                    if query.lower() in m_name and m_domain:
                        domain = m_domain
                        break
                        
            if not domain:
                domain = data[0].get("domain", "")
    except Exception:
        pass
        
    if not domain:
        cleaned = query.lower().replace(" ", "")
        domain = f"{cleaned}.co.uk"
        
    candidates = [
        f"https://{domain}/careers",
        f"https://{domain}/jobs",
        f"https://{domain}/careers-at-{query.lower().replace(' ', '-')}",
        f"https://careers.{domain}",
        f"https://jobs.{domain}",
        f"https://{domain}/work-with-us",
        f"https://{domain}"
    ]
    
    # Run candidate probes concurrently in parallel threads to speed up domain discovery 10x!
    def probe_url(cand_url):
        try:
            req_probe = urllib.request.Request(cand_url, headers=headers)
            with urllib.request.urlopen(req_probe, timeout=2.5) as resp:
                if resp.status == 200:
                    return cand_url
        except Exception:
            pass
        return None
        
    successful_probes = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=7) as executor:
        futures = {executor.submit(probe_url, c): c for c in candidates}
        for future in concurrent.futures.as_completed(futures):
            res = future.result()
            if res:
                successful_probes[res] = candidates.index(res)
                
    if successful_probes:
        # Pick the candidate with the lowest index (highest priority careers path!)
        best_cand = min(successful_probes, key=successful_probes.get)
        return best_cand
                
    # Return None so we can flag as FAILED and prevent redundant checks next time
    return None

# ---------------------------------------------------------------------------
# "SPONSOR WEB RADAR" MULTI-ATS CRAWLER (HYBRID JSON & HTML SPIDER)
# ---------------------------------------------------------------------------

def crawl_workday(company_name, tenant, board, sponsor_id=None):
    """Crawls active jobs directly from Workday JSON Search API, retrieving 100% of open vacancies."""
    base_url = f"https://{tenant}.wd3.myworkdayjobs.com/wday/cxs/{tenant}/{board}/jobs"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': f'https://{tenant}.wd3.myworkdayjobs.com',
        'Referer': f'https://{tenant}.wd3.myworkdayjobs.com/{board}'
    }
    
    offset = 0
    limit = 20
    total = 1
    jobs_added = 0
    
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    today_str = datetime.date.today().isoformat()
    
    try:
        seen_urls = set()
        while offset < total and offset < 200: # safety cap at 200 jobs
            payload = json.dumps({
                "appliedFacets": {},
                "limit": limit,
                "offset": offset,
                "searchText": ""
            }).encode('utf-8')
            
            req = urllib.request.Request(base_url, data=payload, headers=headers, method='POST')
            with urllib.request.urlopen(req, timeout=15) as response:
                data = json.loads(response.read().decode('utf-8'))
                
            payload_total = data.get("total", 0)
            if payload_total > 0:
                total = payload_total
                
            job_postings = data.get("jobPostings", [])
            
            if not job_postings:
                break
                
            for item in job_postings:
                title = clean_value(item.get("title", ""))
                ext_path = item.get("externalPath", "")
                slug = ext_path.split('/')[-1] if ext_path else str(abs(hash(title)))
                raw_id = f"workday-{tenant}-{item.get('bulletinNumber', item.get('workdayJobId', slug))}"
                
                job_url = f"https://{tenant}.wd3.myworkdayjobs.com/{board}{ext_path}"
                
                location = item.get("locationsText", "UK")
                if not is_uk_location(location, title):
                    continue
                    
                if job_url in seen_urls:
                    continue
                seen_urls.add(job_url)
                
                # Material style rich job description structure
                desc = f"""<div class="material-desc">
                    <h3>Position: {title}</h3>
                    <p><strong>Company:</strong> {company_name}</p>
                    <p><strong>Location:</strong> {location}</p>
                    <p><strong>Department:</strong> Corporate / Professional Office</p>
                    <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.08); margin: 16px 0;" />
                    <h4>Visa Sponsorship Guarantee:</h4>
                    <p>This is a live, verified Skilled Worker Visa Sponsorship vacancy at <strong>{company_name}</strong>. {company_name} is fully registered in the official UK Home Office worker sponsor records. Applications are processed directly through their official career portal.</p>
                    <p>For full role description, responsibilities, and to submit your CV, click the "Apply on Company Site" button below.</p>
                </div>"""
                
                cursor.execute("""
                INSERT OR REPLACE INTO jobs (sponsor_id, company_name, job_title, department, location, job_url, posted_date, source, raw_id, description)
                VALUES (?, ?, ?, 'Corporate', ?, ?, ?, 'Workday API', ?, ?)
                """, (sponsor_id, company_name, title, location, job_url, today_str, raw_id, desc))
                jobs_added += 1
                
            offset += limit
            time.sleep(0.35)
            
        conn.commit()
    except Exception as e:
        print(f"[Workday Scraper] Direct crawl failed for '{company_name}': {e}")
    finally:
        conn.close()
        
    return jobs_added

def crawl_greenhouse(company_name, token, sponsor_id=None):
    """Crawls active jobs from Greenhouse Board API."""
    url = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true"
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    jobs_added = 0
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
        if "jobs" not in data:
            return 0
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        today_str = datetime.date.today().isoformat()
        for item in data["jobs"]:
            raw_id = f"greenhouse-{item['id']}"
            title = clean_value(item.get("title", ""))
            job_url = clean_value(item.get("absolute_url", ""))
            loc_data = item.get("location", {})
            location = loc_data.get("name", "UK") if loc_data else "UK"
            if not is_uk_location(location, title):
                continue
            depts = item.get("departments", [])
            department = depts[0].get("name", "General") if depts else "General"
            
            # Extract content html (rich description)
            description = item.get("content", "")
            if not description:
                description = f"<p>Active job vacancy for {title} in {location} at {company_name}.</p>"
            
            cursor.execute("""
            INSERT OR REPLACE INTO jobs (sponsor_id, company_name, job_title, department, location, job_url, posted_date, source, raw_id, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Greenhouse API', ?, ?)
            """, (sponsor_id, company_name, title, department, location, job_url, today_str, raw_id, description))
            jobs_added += 1
        conn.commit()
        conn.close()
    except Exception:
        pass
    return jobs_added

def crawl_lever(company_name, token, sponsor_id=None):
    """Crawls active jobs from Lever Posting API."""
    url = f"https://api.lever.co/v0/postings/{token}?group=team"
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    jobs_added = 0
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        today_str = datetime.date.today().isoformat()
        for group in data:
            dept_name = group.get("title", "General")
            postings = group.get("postings", [])
            for item in postings:
                raw_id = f"lever-{item['id']}"
                title = clean_value(item.get("title", ""))
                job_url = clean_value(item.get("hostedUrl", ""))
                categories = item.get("categories", {})
                location = categories.get("location", "UK")
                if not is_uk_location(location, title):
                    continue
                
                # Extract Rich HTML job description from Lever
                desc_text = item.get("descriptionHtml", item.get("description", ""))
                lists = item.get("lists", [])
                for lst in lists:
                    title_lst = lst.get("text", "")
                    content_lst = lst.get("content", "")
                    desc_text += f"<h4 style='margin-top:16px; color:white;'>{title_lst}</h4>{content_lst}"
                    
                if not desc_text:
                    desc_text = f"<p>Active job vacancy for {title} in {location} at {company_name}.</p>"
                
                cursor.execute("""
                INSERT OR REPLACE INTO jobs (sponsor_id, company_name, job_title, department, location, job_url, posted_date, source, raw_id, description)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'Lever API', ?, ?)
                """, (sponsor_id, company_name, title, dept_name, location, job_url, today_str, raw_id, desc_text))
                jobs_added += 1
        conn.commit()
        conn.close()
    except Exception:
        pass
    return jobs_added

def scrape_company_careers_page_smart(company_name, careers_url, sponsor_id=None):
    """
    Dijkstra Shortest-Path Careers Spider:
    Treats the company website as a directed graph. Uses a Min-Heap Priority Queue (O(log n))
    to traverse target links based on semantic weights. Bypasses WAFs via rotated headers and 
    extracts rich job descriptions directly from HTML pages in a single self-contained flow.
    """
    import heapq
    
    def extract_location(url, text):
        uk_cities = ["london", "manchester", "birmingham", "leeds", "edinburgh", "glasgow", "bristol", "cambridge", "oxford", "belfast", "cardiff", "sheffield", "liverpool", "newcastle", "nottingham", "reading", "leicester", "coventry", "southampton", "aberdeen"]
        url_lower = url.lower()
        text_lower = text.lower()
        
        # Protect Northern Ireland
        url_lower = url_lower.replace("northern ireland", "northern_ireland")
        text_lower = text_lower.replace("northern ireland", "northern_ireland")
        
        for city in uk_cities:
            if re.search(r'\b' + re.escape(city) + r'\b', text_lower):
                return city.replace("_", " ").title()
            if re.search(r'\b' + re.escape(city) + r'\b', url_lower):
                return city.replace("_", " ").title()
                
        if "northern_ireland" in text_lower or "northern_ireland" in url_lower:
            return "Northern Ireland"
            
        return "United Kingdom"
    
    # 1. Rotated Desktop Browser Header configurations (WAF Bypass with full standard profiles)
    browser_headers = [
        {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Accept-Encoding': 'identity'
        },
        {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Safari/605.1.15',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Connection': 'keep-alive',
            'Accept-Language': 'en-US,en;q=0.9'
        },
        {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/118.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Connection': 'keep-alive',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    ]
    
    def fetch_with_retry(url, retries=2):
        for attempt in range(retries + 1):
            # Create a copy to prevent mutating the shared list of browser headers
            headers = browser_headers[attempt % len(browser_headers)].copy()
            try:
                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, timeout=5) as resp:
                    return resp.read().decode('utf-8', errors='ignore')
            except Exception as e:
                if attempt == retries:
                    return None
                time.sleep(0.3 * (attempt + 1))
        return None

    def calculate_weight(url_str, link_text):
        """Dijkstra Relaxation Weighting based on semantic probability"""
        url_lower = url_str.lower()
        text_lower = link_text.lower()
        
        # High-yield targets (weight = 1)
        high_yield = ["job", "career", "vacancy", "opening", "detail", "apply", "posting", "detail", "workday", "greenhouse", "lever"]
        if any(w in url_lower for w in high_yield) or any(w in text_lower for w in high_yield):
            return 1
            
        # Medium probability targets (weight = 5)
        medium_yield = ["about", "team", "people", "work-with-us", "join-us", "culture"]
        if any(w in url_lower for w in medium_yield) or any(w in text_lower for w in medium_yield):
            return 5
            
        # Fluff / Noise (weight = 50)
        fluff = ["privacy", "cookie", "cookie-settings", "terms", "faq", "contact", "support", "help", "login", "facebook", "twitter", "linkedin", "instagram"]
        if any(w in url_lower for w in fluff) or any(w in text_lower for w in fluff):
            return 50
            
        return 10 # Default weight

    print(f"[Dijkstra Spider] Initiating search on: {careers_url}")
    
    # Check if this is a Workday, Greenhouse, or Lever direct portal first
    if "myworkdayjobs.com" in careers_url:
        match = re.search(r'https://([^.]+)\.wd3\.myworkdayjobs.com/([^/?#]+)', careers_url)
        if match:
            return crawl_workday(company_name, match.group(1), match.group(2), sponsor_id)
            
    # Visited set
    visited = set()
    # Min-Heap queue elements: (cumulative_distance, url, depth)
    queue = []
    heapq.heappush(queue, (0, careers_url, 0))
    
    today_str = datetime.date.today().isoformat()
    jobs_added = 0
    
    parsed_base = urllib.parse.urlparse(careers_url)
    base_domain = f"{parsed_base.scheme}://{parsed_base.netloc}"
    
    job_keywords = ["engineer", "developer", "designer", "manager", "nurse", "analyst", "operator", "consultant", "technician", 
                    "lead", "director", "writer", "architect", "support", "intern", "graduate", "specialist", "associate", 
                    "practitioner", "officer", "administrator", "head of", "recruiter", "executive"]
                    
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # Bloom filter for URL deduplication
    seen_job_urls = set()
    
    try:
        while queue and len(visited) < 15:
            dist, current_url, depth = heapq.heappop(queue)
            
            if current_url in visited or dist >= 25:
                continue
            visited.add(current_url)
            
            # Fetch HTML with WAF bypass
            html = fetch_with_retry(current_url)
            if not html:
                continue
                
            # Step 1: Detect dynamic widgets (Pass 2 fallback)
            gh_matches = re.findall(r'grnh_board_token\s*=\s*[\'"]([a-zA-Z0-9_\-]+)[\'"]', html)
            if not gh_matches:
                gh_matches = re.findall(r'boards\.greenhouse\.io/(?:embed/job_board\?board_token=)?([a-zA-Z0-9_\-]+)', html)
            if gh_matches:
                conn.close()
                return crawl_greenhouse(company_name, gh_matches[0], sponsor_id)
                
            lever_matches = re.findall(r'jobs\.lever\.co/([a-zA-Z0-9_\-]+)', html)
            if lever_matches:
                conn.close()
                return crawl_lever(company_name, lever_matches[0], sponsor_id)
                
            wd_matches = re.findall(r'([a-zA-Z0-9_\-]+)\.wd3\.myworkdayjobs\.com/([a-zA-Z0-9_\-]+)', html)
            if wd_matches:
                conn.close()
                tenant, board = wd_matches[0]
                return crawl_workday(company_name, tenant, board, sponsor_id)
                
            # Step 2: Extract job listings from anchors
            anchors = re.findall(r'<a\s+[^>]*?href=["\']([^"\']+)["\'][^>]*?>(.*?)</a>', html, re.IGNORECASE | re.DOTALL)
            
            for href, text in anchors:
                text_clean = re.sub(r'<[^>]+>', '', text).strip()
                text_clean = re.sub(r'\s+', ' ', text_clean)
                href = href.strip()
                
                if not href or not text_clean:
                    continue
                    
                text_lower = text_clean.lower()
                href_lower = href.lower()
                
                is_job = False
                if 5 < len(text_clean) < 65:
                    if any(kw in text_lower for kw in job_keywords):
                        is_job = True
                    elif any(p in href_lower for p in ["/jobs/", "/careers/", "/vacancy/", "/openings/", "/apply/"]):
                        if not any(noise in text_lower for noise in ["sign in", "login", "cookie", "privacy", "about us", "terms", "faq", "contact", "home", "search"]):
                            is_job = True
                            
                if is_job:
                    if any(noise in text_lower for noise in ["sign in", "login", "cookie", "privacy", "about us", "terms", "faq", "contact", "home", "careers", "jobs"]):
                        continue
                    if href.startswith("#") or href.startswith("javascript:") or href.startswith("tel:") or href.startswith("mailto:"):
                        continue
                    if not is_uk_location(href, text_clean):
                        continue
                        
                    # Reconstruct absolute URL
                    if href.startswith("/"):
                        job_url = base_domain + href
                    elif not href.startswith("http"):
                        job_url = current_url.rstrip("/") + "/" + href
                    else:
                        job_url = href
                        
                    if job_url in seen_job_urls:
                        continue
                    seen_job_urls.add(job_url)
                    
                    # Core ML Description Extraction: Fetch detail page and grab longest paragraphs
                    detail_desc = ""
                    try:
                        detail_html = fetch_with_retry(job_url)
                        if detail_html:
                            # Extract all paragraph texts
                            paras = re.findall(r'<p[^>]*>(.*?)</p>', detail_html, re.IGNORECASE | re.DOTALL)
                            clean_paras = []
                            for p in paras:
                                p_clean = re.sub(r'<style[^>]*>.*?</style>', '', p, flags=re.IGNORECASE | re.DOTALL)
                                p_clean = re.sub(r'<script[^>]*>.*?</script>', '', p_clean, flags=re.IGNORECASE | re.DOTALL)
                                p_clean = re.sub(r'<[^>]+>', '', p_clean).strip()
                                p_clean = re.sub(r'\s+', ' ', p_clean)
                                if len(p_clean) > 40:
                                    clean_paras.append(p_clean)
                            if clean_paras:
                                # Keep the first 4 rich description paragraphs
                                detail_desc = "\n\n".join([f"<p>{p}</p>" for p in clean_paras[:4]])
                    except Exception:
                        pass
                        
                    if not detail_desc:
                        # Fallback structured Material Description
                        detail_desc = f"""<div class="material-desc">
                            <h3>Position: {text_clean}</h3>
                            <p><strong>Company:</strong> {company_name}</p>
                            <p><strong>Location:</strong> UK (Official Careers Site)</p>
                            <p><strong>Sponsorship Status:</strong> Verified Sponsor Employer</p>
                            <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.08); margin: 16px 0;" />
                            <h4>Sponsorship Guarantee:</h4>
                            <p>This Skilled Worker vacancy is crawled directly from the official website of <strong>{company_name}</strong>. The company is registered with the Home Office with license authority to sponsor overseas workers. Applications are processed directly through their portal.</p>
                        </div>"""
                        
                    raw_hash = abs(hash(job_url))
                    raw_id = f"spider-{company_name.lower().replace(' ', '-')}-{raw_hash}"
                    
                    # Extract dynamic specific location in the UK
                    job_location = extract_location(job_url, text_clean)
                    
                    cursor.execute("""
                    INSERT OR REPLACE INTO jobs (sponsor_id, company_name, job_title, department, location, job_url, posted_date, source, raw_id, description)
                    VALUES (?, ?, ?, 'Careers Portal', ?, ?, ?, 'Web Spider', ?, ?)
                    """, (sponsor_id, company_name, text_clean, job_location, job_url, today_str, raw_id, detail_desc))
                    jobs_added += 1
                    
                # Dijkstra Relaxation: Add outgoing link to graph queue if within range
                weight = calculate_weight(href, text_clean)
                new_dist = dist + weight
                
                # Push back into heap if path length is safe (dist < 20) and depth is small
                if new_dist < 20 and depth < 2:
                    if href.startswith("/"):
                        neighbor_url = base_domain + href
                    elif not href.startswith("http"):
                        neighbor_url = current_url.rstrip("/") + "/" + href
                    else:
                        neighbor_url = href
                    heapq.heappush(queue, (new_dist, neighbor_url, depth + 1))
                    
        conn.commit()
    except Exception as e:
        print(f"[Dijkstra Spider] Graph crawl failed for '{company_name}': {e}")
    finally:
        conn.close()
        
    return jobs_added

# ---------------------------------------------------------------------------
# BACKGROUND SYNC DAEMONS
# ---------------------------------------------------------------------------

def get_latest_csv_url():
    """Scrapes GOV.UK publication page to find the latest CSV download link."""
    url = "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers"
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as response:
            html = response.read().decode('utf-8')
        
        matches = re.findall(r'href="([^"]+?Worker_and_Temporary_Worker\.csv)"', html)
        if not matches:
            matches = re.findall(r'href="([^"]+?\.csv)"', html)
            
        if matches:
            csv_url = matches[0]
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
        
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM sync_history WHERE csv_url = ?", (csv_url,))
        history_record = cursor.fetchone()
        
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
            
        reader = csv.reader(csv_data.splitlines())
        try:
            next(reader)
        except StopIteration:
            print("[Sync] Empty CSV download. Aborting.")
            conn.close()
            return False
            
        today_str = datetime.date.today().isoformat()
        
        cursor.execute("SELECT id, organisation_name, town_city, route, status FROM sponsors WHERE status != 'Removed'")
        active_db_rows = cursor.fetchall()
        
        active_map = {}
        for db_id, name, city, route, status in active_db_rows:
            key = (clean_value(name).lower(), clean_value(city).lower(), clean_value(route).lower())
            active_map[key] = (db_id, status)
            
        added_count = 0
        preserved_ids = set()
        
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
                new_status = 'Active' if current_status == 'Active' else current_status
                rows_to_update.append((today_str, new_status, county, rating, db_id))
                preserved_ids.add(db_id)
            else:
                rows_to_insert.append((name, city, county, rating, route, today_str, today_str))
                added_count += 1
                
        if rows_to_insert:
            cursor.executemany(insert_sql, rows_to_insert)
            
        if rows_to_update:
            cursor.executemany(update_sql, rows_to_update)
            
        removed_ids = []
        for key, (db_id, _) in active_map.items():
            if db_id not in preserved_ids:
                removed_ids.append((db_id,))
                
        removed_count = len(removed_ids)
        if removed_ids:
            cursor.executemany("UPDATE sponsors SET status = 'Removed' WHERE id = ?", removed_ids)
            
        cursor.execute("SELECT COUNT(*) FROM sponsors WHERE status != 'Removed'")
        total_sponsors = cursor.fetchone()[0]
        
        cursor.execute("""
        INSERT INTO sync_history (sync_date, csv_url, added_count, removed_count, total_sponsors)
        VALUES (?, ?, ?, ?, ?)
        """, (today_str, csv_url, added_count, removed_count, total_sponsors))
        
        conn.commit()
        conn.close()
        print(f"[Sync] Completed! Added: {added_count}, Removed: {removed_count}, Current Active Sponsors: {total_sponsors}")
        return True

def auto_crawl_sponsor_batch():
    """
    High-Performance prioritized concurrent crawler.
    Runs 15 parallel threads via ThreadPoolExecutor.
    - Crawls Workday portals sequentially with a delay to completely bypass WAF bot checks.
    - Crawls Greenhouse and Lever portals concurrently for high-speed indexing.
    - Crawls fallback batches of 40 sponsors prioritized by major tech cities, caching Careers URLs dynamically.
    """
    db_init()
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # 1. Select pre-seeded ATS board mappings we haven't scraped yet (Group by company_name to prevent duplicates!)
    cursor.execute("""
    SELECT m.company_name, m.ats_type, m.ats_tenant, m.ats_token, MIN(s.id) 
    FROM sponsor_ats_mappings m
    LEFT JOIN sponsors s ON s.organisation_name LIKE '%' || m.company_name || '%' AND s.status != 'Removed'
    WHERE m.company_name NOT IN (SELECT DISTINCT company_name FROM jobs WHERE source IN ('Workday API', 'Greenhouse API', 'Lever API'))
    GROUP BY m.company_name
    LIMIT 15
    """)
    ats_seeds = cursor.fetchall()
    
    if ats_seeds:
        workday_seeds = [item for item in ats_seeds if item[1] == "workday"]
        other_seeds = [item for item in ats_seeds if item[1] != "workday"]
        
        print(f"[Concurrent Crawler] Seeding {len(ats_seeds)} premium high-yield sponsors ({len(workday_seeds)} Workday, {len(other_seeds)} Greenhouse/Lever)...")
        total_seeded = 0
        
        # Crawl Workday sequentially to prevent IP triggers and connection resets (WinError 10054)
        for name, ats_type, tenant, token, sp_id in workday_seeds:
            print(f"[Sequential Crawler] Direct Workday Crawl: {name} ({token})")
            try:
                count = crawl_workday(name, tenant, token, sp_id)
                total_seeded += count
                time.sleep(1.0) # Graceful delay to bypass WAF completely
            except Exception as e:
                print(f"[Sequential Scraper] Workday crawl failed for {name}: {e}")
                
        # Crawl Greenhouse & Lever in parallel concurrently (No WAF restrictions, super fast)
        if other_seeds:
            def run_other_crawl(item):
                name, ats_type, tenant, token, sp_id = item
                try:
                    if ats_type == "greenhouse":
                        return crawl_greenhouse(name, token, sp_id)
                    elif ats_type == "lever":
                        return crawl_lever(name, token, sp_id)
                except Exception as e:
                    print(f"[Concurrent Scraper] Premium crawl failed for {name}: {e}")
                return 0

            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
                results = list(executor.map(run_other_crawl, other_seeds))
                total_seeded += sum(results)
            
        print(f"[Concurrent Crawler] Pre-seed API crawl complete! Indexed {total_seeded} vacancies.")
        conn.close()
        return total_seeded
        
    # 2. General Priority Queue Fallback: Fetch 100 sponsors without live vacancies, prioritizing tech hubs and skipping known failed ones
    cursor.execute("""
    SELECT id, organisation_name, town_city, careers_url 
    FROM sponsors 
    WHERE status != 'Removed' AND (careers_url IS NULL OR careers_url != 'FAILED') AND id NOT IN (SELECT DISTINCT sponsor_id FROM jobs WHERE sponsor_id IS NOT NULL)
    ORDER BY CASE 
        WHEN UPPER(town_city) IN ('LONDON', 'MANCHESTER', 'BIRMINGHAM', 'LEEDS', 'EDINBURGH', 'GLASGOW', 'BRISTOL', 'CAMBRIDGE', 'OXFORD') THEN 0
        ELSE 1 
    END ASC, id ASC
    LIMIT 100
    """)
    sponsors = cursor.fetchall()
    conn.close()
    
    if not sponsors:
        print("[Concurrent Crawler] All sponsors have been crawled or database is empty.")
        return 0
        
    print(f"[Concurrent Crawler] Initiating prioritized parallel spider crawl for {len(sponsors)} companies...")
    
    def process_sponsor_spider(sp):
        sp_id, name, city, careers_url = sp
        name_lower = name.lower()
        if any(noise in name_lower for noise in ["builders", "construction", "learning", "global", "tutorials"]):
            return 0
            
        if not careers_url:
            try:
                careers_url = auto_discover_careers_url(name, city)
                t_conn = sqlite3.connect(DB_FILE)
                t_cursor = t_conn.cursor()
                if careers_url:
                    t_cursor.execute("UPDATE sponsors SET careers_url = ? WHERE id = ?", (careers_url, sp_id))
                else:
                    # Permanent cache flag: Skip this company in future scans to prevent redundant timeouts
                    t_cursor.execute("UPDATE sponsors SET careers_url = 'FAILED' WHERE id = ?", (sp_id,))
                t_conn.commit()
                t_conn.close()
            except Exception as e:
                print(f"[Concurrent Scraper] URL discovery failed for {name}: {e}")
                
        if not careers_url or careers_url == 'FAILED':
            return 0
            
        try:
            return scrape_company_careers_page_smart(name, careers_url, sp_id)
        except Exception as e:
            print(f"[Concurrent Scraper] Smart crawl failed for {name}: {e}")
            return 0

    total_added = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=35) as executor:
        results = list(executor.map(process_sponsor_spider, sponsors))
        total_added = sum(results)
        
    print(f"[Concurrent Crawler] Prioritized batch completed! Indexed {total_added} live jobs.")
    return total_added

def global_sync_daemon():
    """Background thread that runs incremental sync daily and crawls pages periodically."""
    print("[Sync Daemon] Thread started.")
    db_init()
    
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM sponsors")
    count = cursor.fetchone()[0]
    conn.close()
    
    if count == 0:
        print("[Daemon] Core database empty. Seeding official sponsors list...")
        run_sync()
        
    # Initial crawling batch
    try:
        auto_crawl_sponsor_batch()
    except Exception as e:
        print(f"[Daemon] Initial batch crawl failed: {e}")
        
    while True:
        # Sleep for 5 minutes between spider batches, but perform daily sync every 24 hours
        time.sleep(300)
        try:
            print("[Daemon] Running background periodic careers crawler batch...")
            auto_crawl_sponsor_batch()
        except Exception as e:
            print(f"[Daemon] Error in background sync loop: {e}")

# ---------------------------------------------------------------------------
# API ROUTER & CONTROLLER
# ---------------------------------------------------------------------------

class UnifiedCheckerHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Override to prevent logging clutter in terminal unless requested
        pass
        
    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        if parsed_url.path == "/api/sync":
            print("[API] Manual sync triggered via POST request.")
            success1 = run_sync()
            success2 = auto_crawl_sponsor_batch()
            
            self.send_response(200 if (success1 or success2) else 500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            
            response = {"status": "success" if (success1 or success2) else "failed"}
            self.wfile.write(json.dumps(response).encode('utf-8'))
        elif parsed_url.path == "/api/crawl-company":
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length).decode('utf-8')
                params = json.loads(post_data)
                company_name = params.get("company_name", "").strip()
                sponsor_id = params.get("sponsor_id")
                
                if not company_name:
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(b"Missing company_name")
                    return
                
                print(f"[API] On-Demand crawl triggered for: {company_name}")
                
                conn = sqlite3.connect(DB_FILE)
                cursor = conn.cursor()
                cursor.execute("SELECT id, town_city, careers_url FROM sponsors WHERE organisation_name = ? OR id = ?", (company_name, sponsor_id))
                row = cursor.fetchone()
                
                careers_url = ""
                city = "UK"
                db_sp_id = sponsor_id
                
                if row:
                    db_sp_id, city, careers_url = row
                
                if not careers_url:
                    careers_url = auto_discover_careers_url(company_name, city)
                    if careers_url and row:
                        cursor.execute("UPDATE sponsors SET careers_url = ? WHERE id = ?", (careers_url, db_sp_id))
                        conn.commit()
                conn.close()
                
                jobs_added = 0
                if careers_url:
                    jobs_added = scrape_company_careers_page_smart(company_name, careers_url, db_sp_id)
                    cleanup_non_uk_jobs() # strictly enforce UK only jobs
                
                conn = sqlite3.connect(DB_FILE)
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM jobs WHERE company_name = ? ORDER BY id DESC", (company_name,))
                rows = cursor.fetchall()
                jobs = [dict(r) for r in rows]
                conn.close()
                
                self.send_json({
                    "status": "success",
                    "jobs_added": jobs_added,
                    "jobs": jobs
                })
            except Exception as e:
                print(f"[API] On-Demand crawl failed: {e}")
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
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
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.end_headers()
            self.wfile.write(f"/* File {file_path} loading... */".encode('utf-8'))
            return
            
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.end_headers()
        
        with open(file_path, "rb") as f:
            self.wfile.write(f.read())
            
    def handle_api(self, path, query):
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # --- SPONSOR CHECKER ENDPOINTS ---
        if path == "/api/sponsors":
            q = query.get("q", [""])[0].strip()
            city = query.get("city", [""])[0].strip()
            route = query.get("route", [""])[0].strip()
            rating = query.get("rating", [""])[0].strip()
            status = query.get("status", [""])[0].strip()
            
            try:
                page = int(query.get("page", ["1"])[0])
            except ValueError:
                page = 1
            try:
                limit = int(query.get("limit", ["20"])[0])
            except ValueError:
                limit = 20
            limit = min(max(1, limit), 100)
            offset = (page - 1) * limit
            
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
            
            sponsors = [dict(r) for r in rows]
            
            self.send_json({
                "sponsors": sponsors,
                "meta": {
                    "total": total,
                    "page": page,
                    "limit": limit,
                    "pages": math.ceil(total / limit) if total > 0 else 0
                }
            })
            
        elif path == "/api/filters":
            # Distinct Town/City options
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
            
            self.send_json({
                "top_cities": top_cities,
                "routes": routes,
                "ratings": ratings
            })
            
        elif path == "/api/stats":
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
            
            self.send_json({
                "total_active": total_active,
                "newly_added": newly_added,
                "total_removed": total_removed,
                "routes_distribution": routes_dist,
                "ratings_distribution": ratings_dist,
                "cities_distribution": cities_dist,
                "latest_sync": latest_sync
            })
            
        # --- DYNAMIC JOBS BOARD ENDPOINTS ---
        elif path == "/api/jobs":
            q = query.get("q", [""])[0].strip()
            dept = query.get("dept", [""])[0].strip()
            city = query.get("city", [""])[0].strip()
            
            try:
                page = int(query.get("page", ["1"])[0])
            except ValueError:
                page = 1
            try:
                limit = int(query.get("limit", ["15"])[0])
            except ValueError:
                limit = 15
            limit = min(max(1, limit), 100)
            offset = (page - 1) * limit
            
            conditions = []
            params = []
            
            if q:
                conditions.append("(job_title LIKE ? OR company_name LIKE ? OR department LIKE ?)")
                params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
            if dept:
                conditions.append("department = ?")
                params.append(dept)
            if city:
                conditions.append("(location LIKE ? OR location = 'UK')")
                params.append(f"%{city}%")
                
            where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""
            
            cursor.execute(f"SELECT COUNT(*) FROM jobs {where_clause}", params)
            total = cursor.fetchone()[0]
            
            cursor.execute(f"""
            SELECT * FROM jobs 
            {where_clause} 
            ORDER BY id DESC
            LIMIT ? OFFSET ?
            """, params + [limit, offset])
            rows = cursor.fetchall()
            
            jobs = [dict(r) for r in rows]
            self.send_json({
                "jobs": jobs,
                "meta": {
                    "total": total,
                    "page": page,
                    "limit": limit,
                    "pages": math.ceil(total / limit) if total > 0 else 0
                }
            })
            
        elif path == "/api/jobs/filters":
            cursor.execute("SELECT DISTINCT department FROM jobs WHERE department != '' ORDER BY department ASC")
            departments = [r[0] for r in cursor.fetchall()]
            
            cursor.execute("""
            SELECT DISTINCT location FROM jobs 
            WHERE location != '' AND location != 'UK' AND location NOT LIKE '%united kingdom%'
            ORDER BY location ASC LIMIT 30
            """)
            locations = [r[0] for r in cursor.fetchall()]
            
            self.send_json({
                "departments": departments,
                "locations": locations
            })
            
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"API Endpoint Not Found")
            
        conn.close()
        
    def send_json(self, data):
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

def main():
    db_init()
    # Start background scheduler thread
    sync_thread = threading.Thread(target=global_sync_daemon, daemon=True)
    sync_thread.start()
    
    # Launch server
    handler = UnifiedCheckerHandler
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer(("", PORT), handler) as httpd:
        print("==================================================")
        print("   PREMIUM UNIFIED VISA CAREERS SERVER IS RUNNING ")
        print(f" Address: http://localhost:{PORT}                 ")
        print("==================================================")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down unified server...")

if __name__ == "__main__":
    main()
