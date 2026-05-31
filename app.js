/* ==========================================================================
   ukSponsorJobs - Premium Client Core Engine (State & API Integrator)
   ========================================================================== */

// 1. CORE ENVIRONMENT & API ROUTER
const isLocal = window.location.hostname === 'localhost' || 
                window.location.hostname === '127.0.0.1' || 
                window.location.hostname.startsWith('192.168.') || 
                window.location.hostname.startsWith('10.') || 
                window.location.hostname.startsWith('172.') || 
                window.location.hostname.endsWith('.local') ||
                window.location.port !== '';
const BACKEND_URL = isLocal ? '' : 'https://uk-sponsor-radar-backend.onrender.com';

// 2. UNIFIED STATE MANAGEMENT
let state = {
    // Current Navigation Tab: jobs, sponsors, bookmarks, analytics
    activeTab: 'jobs',
    
    // Careers Jobs Board State
    jobsSearchQuery: '',
    jobsSelectedDept: '',
    jobsSelectedLocation: '',
    jobsCurrentPage: 1,
    jobsTotalPages: 1,
    jobsLimit: 15,
    
    // Sponsor Directory Checker State
    sponsorSearchQuery: '',
    sponsorSelectedRoute: '',
    sponsorSelectedRating: '',
    sponsorSelectedCity: '',
    sponsorSortBy: 'organisation_name',
    sponsorSortDir: 'asc',
    sponsorCurrentPage: 1,
    sponsorTotalPages: 1,
    sponsorLimit: 20,
    
    // Bookmarks and Compare tray caches
    bookmarks: [],
    compareList: [],
    
    // Debounce & Abort controller pipelines
    searchDebounceTimer: null,
    activeAbortController: null,
    
    // Analytics Metrics Cache
    analyticsData: null
};

// 3. SEAMLESS DOM SELECTOR BINDINGS
const DOM = {
    // Nav triggers
    tabJobs: document.getElementById('btn-tab-jobs'),
    tabSponsors: document.getElementById('btn-tab-sponsors'),
    tabBookmarks: document.getElementById('btn-tab-bookmarks'),
    tabAnalytics: document.getElementById('btn-tab-analytics'),
    
    // Pane Containers
    paneJobs: document.getElementById('pane-jobs'),
    paneSponsors: document.getElementById('pane-sponsors'),
    paneBookmarks: document.getElementById('pane-bookmarks'),
    paneAnalytics: document.getElementById('pane-analytics'),
    
    // Header & Global Metrics
    statsTotalJobs: document.getElementById('stats-total-jobs'),
    statsTotalActive: document.getElementById('stats-total-active'),
    statsNewlyAdded: document.getElementById('stats-newly-added'),
    statsSkilledWorker: document.getElementById('stats-skilled-worker'),
    statsSkilledWorkerRatio: document.getElementById('stats-skilled-worker-ratio'),
    syncStatusText: document.getElementById('sync-status-text'),
    manualSyncBtn: document.getElementById('manual-sync-btn'),
    
    // Careers Jobs Board Elements
    jobsSearchInput: document.getElementById('jobs-search-input'),
    filterDept: document.getElementById('filter-dept'),
    filterJobsCity: document.getElementById('filter-jobs-city'),
    jobsGridContainer: document.getElementById('jobs-grid-container'),
    jobsResultsCount: document.getElementById('jobs-results-count'),
    jobsPaginationControls: document.getElementById('jobs-pagination-controls'),
    
    // Sponsor Directory Elements
    sponsorsSearchInput: document.getElementById('sponsors-search-input'),
    searchClearBtn: document.getElementById('search-clear-btn'),
    resetFiltersBtn: document.getElementById('reset-filters-btn'),
    filterRoute: document.getElementById('filter-route'),
    filterRating: document.getElementById('filter-rating'),
    filterCity: document.getElementById('filter-city'),
    filterLimit: document.getElementById('filter-limit'),
    sponsorTableBody: document.getElementById('sponsor-table-body'),
    tableLoading: document.getElementById('table-loading'),
    tableEmpty: document.getElementById('table-empty'),
    tablePaginationNav: document.getElementById('table-pagination-nav'),
    paginationSummary: document.getElementById('pagination-summary'),
    pagFirst: document.getElementById('pag-first'),
    pagPrev: document.getElementById('pag-prev'),
    pagNext: document.getElementById('pag-next'),
    pagLast: document.getElementById('pag-last'),
    
    // Table Sorting Headers
    thName: document.getElementById('th-name'),
    thCity: document.getElementById('th-city'),
    thRoute: document.getElementById('th-route'),
    thRating: document.getElementById('th-rating'),
    
    // Starred Bookmarks Elements
    badgeCountBookmarks: document.getElementById('badge-count-bookmarks'),
    bookmarksEmpty: document.getElementById('bookmarks-empty'),
    bookmarksTable: document.getElementById('bookmarks-table'),
    bookmarksTableBody: document.getElementById('bookmarks-table-body'),
    
    // Compare Tray Elements
    compareBar: document.getElementById('compare-bar'),
    compareBadgeCount: document.getElementById('compare-badge-count'),
    compareClearBtn: document.getElementById('compare-clear-btn'),
    compareTriggerBtn: document.getElementById('compare-trigger-btn'),
    compareDrawerItems: document.getElementById('compare-drawer-items'),
    
    // Modals & Panels overlays
    compareModal: document.getElementById('compare-modal'),
    compareModalClose: document.getElementById('compare-modal-close'),
    compareMatrixTable: document.getElementById('compare-matrix-table'),
    
    detailsModal: document.getElementById('details-modal'),
    detailsModalClose: document.getElementById('details-modal-close'),
    detailsStatusBadge: document.getElementById('details-status-badge'),
    detailsName: document.getElementById('details-name'),
    detailsCity: document.getElementById('details-city'),
    detailsCounty: document.getElementById('details-county'),
    detailsRoute: document.getElementById('details-route'),
    detailsRatingBadge: document.getElementById('details-rating-badge'),
    detailsLastSeen: document.getElementById('details-last-seen'),
    detailsModalBookmarkBtn: document.getElementById('details-modal-bookmark-btn'),
    detailsModalCompareBtn: document.getElementById('details-modal-compare-btn'),
    
    btnSearchLinkedin: document.getElementById('btn-search-linkedin'),
    btnSearchIndeed: document.getElementById('btn-search-indeed'),
    btnSearchGlassdoor: document.getElementById('btn-search-glassdoor'),
    btnSearchGoogle: document.getElementById('btn-search-google'),
    
    // Sliding Drawer Details
    drawerOverlay: document.getElementById('drawer-overlay'),
    detailsDrawer: document.getElementById('details-drawer'),
    drawerContentBox: document.getElementById('drawer-content-box'),
    
    // Analytics Charts
    chartCitiesList: document.getElementById('chart-cities-list'),
    chartRoutesList: document.getElementById('chart-routes-list'),
    chartRatingsList: document.getElementById('chart-ratings-list'),
    systemLogsList: document.getElementById('system-logs-list'),

    // Real-Time On-Demand Career Scanner DOM Selectors
    btnScanJobs: document.getElementById('btn-scan-jobs'),
    scanResultsBox: document.getElementById('scan-results-box'),
    scanSpinner: document.getElementById('scan-spinner'),
    scanStatusText: document.getElementById('scan-status-text'),
    scanJobsList: document.getElementById('scan-jobs-list')
};

// 4. APPLICATION CORE INITIALIZATION
window.addEventListener('DOMContentLoaded', () => {
    initEvents();
    loadBookmarks();
    fetchStats();
    fetchSponsorDropdowns();
    fetchJobsFilters();
    runSearch(); // Default searches jobs board
});

// 5. EVENT LISTENERS REGISTER
function initEvents() {
    // 5a. Primary Tab Switch routing
    const tabs = [
        { btn: DOM.tabJobs, tabId: 'jobs' },
        { btn: DOM.tabSponsors, tabId: 'sponsors' },
        { btn: DOM.tabBookmarks, tabId: 'bookmarks' },
        { btn: DOM.tabAnalytics, tabId: 'analytics' }
    ];
    tabs.forEach(t => {
        if (t.btn) {
            t.btn.addEventListener('click', () => switchTab(t.tabId));
        }
    });
    
    // 5b. Careers Jobs Board Search Event Handlers
    if (DOM.jobsSearchInput) {
        DOM.jobsSearchInput.addEventListener('input', (e) => {
            state.jobsSearchQuery = e.target.value.trim();
            state.jobsCurrentPage = 1;
            
            clearTimeout(state.searchDebounceTimer);
            state.searchDebounceTimer = setTimeout(() => {
                runSearch();
            }, 250);
        });
    }
    if (DOM.filterDept) {
        DOM.filterDept.addEventListener('change', (e) => {
            state.jobsSelectedDept = e.target.value;
            state.jobsCurrentPage = 1;
            runSearch();
        });
    }
    if (DOM.filterJobsCity) {
        DOM.filterJobsCity.addEventListener('change', (e) => {
            state.jobsSelectedLocation = e.target.value;
            state.jobsCurrentPage = 1;
            runSearch();
        });
    }
    
    // 5c. Sponsor Directory Event Handlers
    if (DOM.sponsorsSearchInput) {
        DOM.sponsorsSearchInput.addEventListener('input', (e) => {
            state.sponsorSearchQuery = e.target.value.trim();
            DOM.searchClearBtn.style.display = state.sponsorSearchQuery ? 'block' : 'none';
            state.sponsorCurrentPage = 1;
            
            clearTimeout(state.searchDebounceTimer);
            state.searchDebounceTimer = setTimeout(() => {
                runSearch();
            }, 250);
        });
    }
    if (DOM.searchClearBtn) {
        DOM.searchClearBtn.addEventListener('click', () => {
            DOM.sponsorsSearchInput.value = '';
            state.sponsorSearchQuery = '';
            DOM.searchClearBtn.style.display = 'none';
            state.sponsorCurrentPage = 1;
            runSearch();
        });
    }
    if (DOM.resetFiltersBtn) {
        DOM.resetFiltersBtn.addEventListener('click', resetSponsorFilters);
    }
    
    // Dropdown filters for Sponsors
    if (DOM.filterRoute) {
        DOM.filterRoute.addEventListener('change', (e) => {
            state.sponsorSelectedRoute = e.target.value;
            state.sponsorCurrentPage = 1;
            runSearch();
        });
    }
    if (DOM.filterRating) {
        DOM.filterRating.addEventListener('change', (e) => {
            state.sponsorSelectedRating = e.target.value;
            state.sponsorCurrentPage = 1;
            runSearch();
        });
    }
    if (DOM.filterCity) {
        DOM.filterCity.addEventListener('change', (e) => {
            state.sponsorSelectedCity = e.target.value;
            state.sponsorCurrentPage = 1;
            runSearch();
        });
    }
    if (DOM.filterLimit) {
        DOM.filterLimit.addEventListener('change', (e) => {
            state.sponsorLimit = parseInt(e.target.value);
            state.sponsorCurrentPage = 1;
            runSearch();
        });
    }
    
    // Headers sort triggers
    const sortHeaders = [
        { el: DOM.thName, key: 'organisation_name' },
        { el: DOM.thCity, key: 'town_city' },
        { el: DOM.thRoute, key: 'route' },
        { el: DOM.thRating, key: 'rating' }
    ];
    sortHeaders.forEach(th => {
        if (th.el) {
            th.el.addEventListener('click', () => handleSort(th.key));
        }
    });
    
    // Pagination navigation for sponsors
    if (DOM.pagFirst) DOM.pagFirst.addEventListener('click', () => changeSponsorsPage('first'));
    if (DOM.pagPrev) DOM.pagPrev.addEventListener('click', () => changeSponsorsPage('prev'));
    if (DOM.pagNext) DOM.pagNext.addEventListener('click', () => changeSponsorsPage('next'));
    if (DOM.pagLast) DOM.pagLast.addEventListener('click', () => changeSponsorsPage('last'));
    
    // Modals closings
    if (DOM.compareModalClose) DOM.compareModalClose.addEventListener('click', () => DOM.compareModal.style.display = 'none');
    if (DOM.compareModal) {
        DOM.compareModal.addEventListener('click', (e) => {
            if (e.target === DOM.compareModal) DOM.compareModal.style.display = 'none';
        });
    }
    
    if (DOM.detailsModalClose) DOM.detailsModalClose.addEventListener('click', () => DOM.detailsModal.style.display = 'none');
    if (DOM.detailsModal) {
        DOM.detailsModal.addEventListener('click', (e) => {
            if (e.target === DOM.detailsModal) DOM.detailsModal.style.display = 'none';
        });
    }
    
    // Bottom Tray select events
    if (DOM.compareClearBtn) DOM.compareClearBtn.addEventListener('click', clearCompareTray);
    if (DOM.compareTriggerBtn) DOM.compareTriggerBtn.addEventListener('click', openCompareMatrix);
    
    // Manual Database crawler sync triggers
    if (DOM.manualSyncBtn) DOM.manualSyncBtn.addEventListener('click', triggerManualSync);
}

// 6. TABS ROUTING SYSTEM
function switchTab(tabId) {
    state.activeTab = tabId;
    
    // Toggle active classes on navigation triggers
    [DOM.tabJobs, DOM.tabSponsors, DOM.tabBookmarks, DOM.tabAnalytics].forEach(el => {
        if (el) el.classList.toggle('active', el.dataset.tab === tabId);
    });
    
    // Swapping viewport active cards
    [DOM.paneJobs, DOM.paneSponsors, DOM.paneBookmarks, DOM.paneAnalytics].forEach(el => {
        if (el) el.classList.toggle('active', el.id.includes(tabId));
    });
    
    if (tabId === 'bookmarks') {
        renderBookmarksTab();
    } else if (tabId === 'analytics') {
        renderAnalyticsCharts();
    } else {
        runSearch();
    }
}

// 7. REST CONNECTIONS & DATA LOADERS
async function runSearch() {
    if (state.activeAbortController) {
        state.activeAbortController.abort();
    }
    state.activeAbortController = new AbortController();
    const signal = state.activeAbortController.signal;
    
    if (state.activeTab === 'jobs') {
        toggleJobsLoading(true);
        try {
            const params = new URLSearchParams({
                q: state.jobsSearchQuery,
                dept: state.jobsSelectedDept,
                city: state.jobsSelectedLocation,
                page: state.jobsCurrentPage,
                limit: state.jobsLimit
            });
            const res = await fetch(`${BACKEND_URL}/api/jobs?${params.toString()}`, { signal });
            const data = await res.json();
            
            state.jobsTotalPages = data.meta.pages;
            renderJobsFeed(data.jobs, data.meta);
            renderJobsPagination();
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error("Jobs search failed:", e);
                showJobsError();
            }
        } finally {
            toggleJobsLoading(false);
        }
    } else if (state.activeTab === 'sponsors') {
        toggleSponsorsLoading(true);
        try {
            const params = new URLSearchParams({
                q: state.sponsorSearchQuery,
                route: state.sponsorSelectedRoute,
                rating: state.sponsorSelectedRating,
                city: state.sponsorSelectedCity,
                page: state.sponsorCurrentPage,
                limit: state.sponsorLimit,
                sort_by: state.sponsorSortBy,
                sort_dir: state.sponsorSortDir
            });
            const res = await fetch(`${BACKEND_URL}/api/sponsors?${params.toString()}`, { signal });
            const data = await res.json();
            
            state.sponsorTotalPages = data.meta.pages;
            renderSponsorsTable(data.sponsors);
            updateSponsorsPaginationUI(data.meta);
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error("Sponsors directory query failed:", e);
                showSponsorsError();
            }
        } finally {
            toggleSponsorsLoading(false);
        }
    }
}

// 8. DROPDOWNS & METRICS PULLERS
async function fetchStats() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/stats`);
        const data = await res.json();
        
        DOM.statsTotalActive.textContent = data.total_active.toLocaleString();
        DOM.statsNewlyAdded.textContent = data.newly_added.toLocaleString();
        
        const skilledWorkerObj = data.routes_distribution.find(r => r.route === 'Skilled Worker');
        const swCount = skilledWorkerObj ? skilledWorkerObj.count : 0;
        DOM.statsSkilledWorker.textContent = swCount.toLocaleString();
        
        const swRatio = data.total_active > 0 ? ((swCount / data.total_active) * 100).toFixed(1) : 0;
        DOM.statsSkilledWorkerRatio.textContent = `${swRatio}% of all sponsors`;
        
        if (data.latest_sync) {
            DOM.syncStatusText.textContent = `GOV.UK Sync: ${data.latest_sync.sync_date}`;
        } else {
            DOM.syncStatusText.textContent = "Offline Database Mode";
        }
        
        state.analyticsData = data;
        
        // Push total vacancy count dynamically
        const jobsRes = await fetch(`${BACKEND_URL}/api/jobs?limit=1`);
        const jobsData = await jobsRes.json();
        if (DOM.statsTotalJobs && jobsData.meta) {
            DOM.statsTotalJobs.textContent = jobsData.meta.total.toLocaleString();
        }
    } catch (e) {
        console.error("Failed to fetch metric stats:", e);
    }
}

async function fetchSponsorDropdowns() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/filters`);
        const data = await res.json();
        
        DOM.filterRoute.innerHTML = '<option value="">All Sponsorship Routes</option>';
        data.routes.forEach(route => {
            const opt = document.createElement('option');
            opt.value = route;
            opt.textContent = route;
            DOM.filterRoute.appendChild(opt);
        });
        
        DOM.filterRating.innerHTML = '<option value="">All Licence Ratings</option>';
        data.ratings.forEach(rating => {
            const opt = document.createElement('option');
            opt.value = rating;
            opt.textContent = rating;
            DOM.filterRating.appendChild(opt);
        });
        
        DOM.filterCity.innerHTML = '<option value="">All Towns & Cities</option>';
        data.top_cities.forEach(cityObj => {
            const opt = document.createElement('option');
            opt.value = cityObj.town_city;
            opt.textContent = `${cityObj.town_city} (${cityObj.count})`;
            DOM.filterCity.appendChild(opt);
        });
    } catch (e) {
        console.error("Error loading sponsor drop elements:", e);
    }
}

async function fetchJobsFilters() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/jobs/filters`);
        const data = await res.json();
        
        DOM.filterDept.innerHTML = '<option value="">All Departments</option>';
        DOM.filterJobsCity.innerHTML = '<option value="">Any Location (UK)</option>';
        
        data.departments.forEach(dept => {
            const opt = document.createElement('option');
            opt.value = dept;
            opt.textContent = dept;
            DOM.filterDept.appendChild(opt);
        });
        
        data.locations.forEach(loc => {
            const opt = document.createElement('option');
            opt.value = loc;
            opt.textContent = loc;
            DOM.filterJobsCity.appendChild(opt);
        });
    } catch (e) {
        console.error("Error loading job board select filters:", e);
    }
}

// 9. DYNAMIC JOBS FEED RENDERERS
function renderJobsFeed(jobs, meta) {
    DOM.jobsGridContainer.innerHTML = '';
    DOM.jobsResultsCount.textContent = `${meta.total.toLocaleString()} live visa-sponsorship roles found`;
    
    if (jobs.length === 0) {
        DOM.jobsGridContainer.innerHTML = `
            <div class="table-placeholder-state" style="grid-column: 1 / -1;">
                <p>No sponsorship roles found matching your active criteria.</p>
                <p style="font-size:12px; color:var(--text-muted);">Try resetting keywords or selecting general location hubs.</p>
            </div>
        `;
        return;
    }
    
    jobs.forEach(job => {
        const card = document.createElement('div');
        card.className = 'job-card';
        card.onclick = () => openJobDrawer(job);
        
        const daysAgo = getDaysAgo(job.posted_date);
        const dateStr = daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`;
        
        card.innerHTML = `
            <div class="job-card-header">
                <div class="job-company">${escapeHTML(job.company_name)}</div>
                <h3 class="job-title">${escapeHTML(job.job_title)}</h3>
            </div>
            <div class="job-badges">
                <span class="badge badge-dept">${escapeHTML(job.department)}</span>
                <span class="badge badge-loc">${escapeHTML(job.location)}</span>
                <span class="badge badge-source">${escapeHTML(job.source)}</span>
            </div>
            <div class="job-card-footer">
                <span>${dateStr}</span>
                <span class="arrow-link">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                </span>
            </div>
        `;
        DOM.jobsGridContainer.appendChild(card);
    });
}

function renderJobsPagination() {
    DOM.jobsPaginationControls.innerHTML = '';
    if (state.jobsTotalPages <= 1) return;
    
    const prevBtn = document.createElement('button');
    prevBtn.className = 'pag-btn';
    prevBtn.disabled = state.jobsCurrentPage === 1;
    prevBtn.textContent = 'Prev';
    prevBtn.onclick = () => {
        state.jobsCurrentPage--;
        runSearch();
        window.scrollTo({ top: 350, behavior: 'smooth' });
    };
    DOM.jobsPaginationControls.appendChild(prevBtn);
    
    let startPage = Math.max(1, state.jobsCurrentPage - 2);
    let endPage = Math.min(state.jobsTotalPages, startPage + 4);
    if (endPage - startPage < 4) {
        startPage = Math.max(1, endPage - 4);
    }
    
    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.className = `pag-btn ${state.jobsCurrentPage === i ? 'active' : ''}`;
        btn.textContent = i;
        if (state.jobsCurrentPage === i) btn.style.background = 'var(--accent-primary)';
        btn.onclick = () => {
            state.jobsCurrentPage = i;
            runSearch();
            window.scrollTo({ top: 350, behavior: 'smooth' });
        };
        DOM.jobsPaginationControls.appendChild(btn);
    }
    
    const nextBtn = document.createElement('button');
    nextBtn.className = 'pag-btn';
    nextBtn.disabled = state.jobsCurrentPage === state.jobsTotalPages;
    nextBtn.textContent = 'Next';
    nextBtn.onclick = () => {
        state.jobsCurrentPage++;
        runSearch();
        window.scrollTo({ top: 350, behavior: 'smooth' });
    };
    DOM.jobsPaginationControls.appendChild(nextBtn);
}

// 10. SLIDING DETAILS SHEET DRAWER
window.openJobDrawer = function(job) {
    DOM.drawerContentBox.innerHTML = '';
    
    DOM.drawerContentBox.innerHTML = `
        <div class="drawer-header">
            <span class="drawer-company">${escapeHTML(job.company_name)}</span>
            <h2 class="drawer-title">${escapeHTML(job.job_title)}</h2>
        </div>
        
        <div class="drawer-meta-grid">
            <div class="drawer-meta-item">
                <span class="meta-item-label">Job Category</span>
                <span class="meta-item-value">${escapeHTML(job.department)}</span>
            </div>
            <div class="drawer-meta-item">
                <span class="meta-item-label">Location</span>
                <span class="meta-item-value">${escapeHTML(job.location)}</span>
            </div>
            <div class="drawer-meta-item">
                <span class="meta-item-label">Source Sync</span>
                <span class="meta-item-value">${escapeHTML(job.source)}</span>
            </div>
            <div class="drawer-meta-item">
                <span class="meta-item-label">Visa Route</span>
                <span class="meta-item-value">Skilled Worker (Sponsorship)</span>
            </div>
        </div>
        
        <div class="drawer-desc-block">
            <span class="drawer-desc-title">Job Details & Description</span>
            <div class="drawer-desc-content">
                ${job.description ? job.description : `
                    <p>Detailed job listing for <strong>${escapeHTML(job.job_title)}</strong> is hosted directly on the employer's official careers site.</p>
                    <p><strong>${escapeHTML(job.company_name)}</strong> is a fully-certified UK Home Office visa sponsor. Click the primary apply button below to view full details and submit your application.</p>
                `}
            </div>
        </div>
        
        <div class="action-btn-container">
            <button class="btn-primary-glow" onclick="window.open('${job.job_url}', '_blank')">
                Apply on Company Site
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </button>
            <button class="btn-secondary-border" onclick="window.open('https://www.google.com/search?q=${encodeURIComponent(job.company_name)}+careers+jobs', '_blank')">
                Research Company on Google
            </button>
        </div>
    `;
    
    toggleDrawer(true);
};

function toggleDrawer(isOpen) {
    DOM.detailsDrawer.classList.toggle('active', isOpen);
    DOM.drawerOverlay.classList.toggle('active', isOpen);
}

window.closeDrawer = function() {
    toggleDrawer(false);
};

// 11. SPONSORS TABLE RENDERING
function renderSponsorsTable(sponsors) {
    DOM.sponsorTableBody.innerHTML = '';
    
    if (!sponsors || sponsors.length === 0) {
        DOM.tableEmpty.style.display = 'flex';
        DOM.tablePaginationNav.style.display = 'none';
        return;
    }
    
    DOM.tableEmpty.style.display = 'none';
    DOM.tablePaginationNav.style.display = 'flex';
    
    sponsors.forEach(s => {
        const tr = document.createElement('tr');
        tr.dataset.id = s.id;
        
        const tdName = document.createElement('td');
        tdName.className = 'company-name-cell';
        tdName.textContent = s.organisation_name;
        
        const tdCity = document.createElement('td');
        tdCity.textContent = s.town_city || '—';
        
        const tdRoute = document.createElement('td');
        tdRoute.textContent = s.route;
        
        const tdRating = document.createElement('td');
        const ratingClass = s.rating.includes('A rating') ? 'badge-rating-a' : 'badge-rating-b';
        tdRating.innerHTML = `<span class="badge-rating ${ratingClass}">${s.rating}</span>`;
        
        const tdActions = document.createElement('td');
        tdActions.className = 'align-center';
        
        const isStarred = state.bookmarks.some(b => b.id === s.id);
        const starClass = isStarred ? 'starred' : '';
        
        tdActions.innerHTML = `
            <div class="action-buttons-cell">
                <button class="icon-btn-star ${starClass}" title="Bookmark Sponsor" onclick="event.stopPropagation(); toggleBookmark(${JSON.stringify(s).replace(/"/g, '&quot;')})">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="${isStarred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
                    </svg>
                </button>
                <button class="icon-btn-view" title="Open Sponsor details">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                    </svg>
                </button>
            </div>
        `;
        
        tr.appendChild(tdName);
        tr.appendChild(tdCity);
        tr.appendChild(tdRoute);
        tr.appendChild(tdRating);
        tr.appendChild(tdActions);
        
        tr.addEventListener('click', () => openSponsorDetails(s));
        DOM.sponsorTableBody.appendChild(tr);
    });
}

function updateSponsorsPaginationUI(meta) {
    DOM.paginationSummary.textContent = `Page ${meta.page} of ${meta.pages || 1}`;
    
    DOM.pagFirst.disabled = meta.page <= 1;
    DOM.pagPrev.disabled = meta.page <= 1;
    DOM.pagNext.disabled = meta.page >= meta.pages;
    DOM.pagLast.disabled = meta.page >= meta.pages;
    
    state.sponsorTotalPages = meta.pages;
}

function changeSponsorsPage(dir) {
    if (dir === 'first') state.sponsorCurrentPage = 1;
    else if (dir === 'prev' && state.sponsorCurrentPage > 1) state.sponsorCurrentPage--;
    else if (dir === 'next' && state.sponsorCurrentPage < state.sponsorTotalPages) state.sponsorCurrentPage++;
    else if (dir === 'last') state.sponsorCurrentPage = state.sponsorTotalPages;
    
    runSearch();
}

function resetSponsorFilters() {
    DOM.sponsorsSearchInput.value = '';
    DOM.filterRoute.value = '';
    DOM.filterRating.value = '';
    DOM.filterCity.value = '';
    DOM.filterLimit.value = '20';
    
    state.sponsorSearchQuery = '';
    state.sponsorSelectedRoute = '';
    state.sponsorSelectedRating = '';
    state.sponsorSelectedCity = '';
    state.sponsorLimit = 20;
    state.sponsorCurrentPage = 1;
    DOM.searchClearBtn.style.display = 'none';
    
    runSearch();
}

function handleSort(col) {
    if (state.sponsorSortBy === col) {
        state.sponsorSortDir = state.sponsorSortDir === 'asc' ? 'desc' : 'asc';
    } else {
        state.sponsorSortBy = col;
        state.sponsorSortDir = 'asc';
    }
    
    // Sort caret icons update
    [DOM.thName, DOM.thCity, DOM.thRoute, DOM.thRating].forEach(th => {
        th.querySelector('.sort-icon').textContent = '';
        th.classList.remove('active');
    });
    
    const thMap = {
        'organisation_name': DOM.thName,
        'town_city': DOM.thCity,
        'route': DOM.thRoute,
        'rating': DOM.thRating
    };
    
    const th = thMap[col];
    th.classList.add('active');
    th.querySelector('.sort-icon').textContent = state.sponsorSortDir === 'desc' ? '▼' : '▲';
    
    state.sponsorCurrentPage = 1;
    runSearch();
}

// 12. DETAILED SPONSOR MATRIX OVERLAYS
function openSponsorDetails(s) {
    DOM.detailsName.textContent = s.organisation_name;
    DOM.detailsCity.textContent = s.town_city || '—';
    DOM.detailsCounty.textContent = s.county || '—';
    DOM.detailsRoute.textContent = s.route;
    DOM.detailsRatingBadge.textContent = s.rating;
    DOM.detailsLastSeen.textContent = s.last_seen || s.date_added || '—';
    
    // Style active rating badge
    const ratingClass = s.rating.includes('A rating') ? 'badge-rating-a' : 'badge-rating-b';
    DOM.detailsRatingBadge.className = `info-val badge-rating ${ratingClass}`;
    
    // Configure smart deep link research anchors
    const encName = encodeURIComponent(s.organisation_name);
    DOM.btnSearchLinkedin.href = `https://www.linkedin.com/jobs/search/?keywords=${encName}`;
    DOM.btnSearchIndeed.href = `https://www.indeed.co.uk/jobs?q=${encName}`;
    DOM.btnSearchGlassdoor.href = `https://www.glassdoor.co.uk/Search/results.htm?keyword=${encName}`;
    DOM.btnSearchGoogle.href = `https://www.google.com/search?q=${encName}`;
    
    // Star toggle states inside modal
    const isStarred = state.bookmarks.some(b => b.id === s.id);
    DOM.detailsModalBookmarkBtn.innerHTML = isStarred ? 'Remove Bookmark' : 'Bookmark Sponsor';
    DOM.detailsModalBookmarkBtn.onclick = () => {
        toggleBookmark(s);
        const starred = state.bookmarks.some(b => b.id === s.id);
        DOM.detailsModalBookmarkBtn.innerHTML = starred ? 'Remove Bookmark' : 'Bookmark Sponsor';
    };
    
    // Compare matrix toggle states inside modal
    const matchingCompare = state.compareList.some(comp => comp.id === s.id);
    DOM.detailsModalCompareBtn.innerHTML = matchingCompare ? 'Remove Compare' : 'Add to Compare';
    DOM.detailsModalCompareBtn.onclick = () => {
        toggleCompare(s);
        const insideCompare = state.compareList.some(comp => comp.id === s.id);
        DOM.detailsModalCompareBtn.innerHTML = insideCompare ? 'Remove Compare' : 'Add to Compare';
    };
    
    // Reset scanner UI
    if (DOM.scanResultsBox) DOM.scanResultsBox.style.display = 'none';
    if (DOM.btnScanJobs) {
        DOM.btnScanJobs.style.display = 'block';
        DOM.btnScanJobs.disabled = false;
        DOM.btnScanJobs.innerHTML = 'Scan Company Careers Site';
        DOM.btnScanJobs.onclick = () => triggerOnDemandScan(s.organisation_name, s.id);
    }
    
    DOM.detailsModal.style.display = 'flex';
}

// 12b. ON-DEMAND DIJKSTRA WEB-SPIDER CAREER SCANNER
async function triggerOnDemandScan(companyName, sponsorId) {
    if (!DOM.btnScanJobs || !DOM.scanResultsBox || !DOM.scanSpinner || !DOM.scanStatusText || !DOM.scanJobsList) return;
    
    // UI Feedback state transition
    DOM.btnScanJobs.style.display = 'none';
    DOM.scanResultsBox.style.display = 'block';
    DOM.scanSpinner.style.display = 'block';
    DOM.scanStatusText.textContent = "Traversing links and scanning careers page with Dijkstra Spider...";
    DOM.scanJobsList.innerHTML = '';
    
    try {
        const res = await fetch(`${BACKEND_URL}/api/crawl-company`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                company_name: companyName,
                sponsor_id: sponsorId
            })
        });
        
        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }
        
        const data = await res.json();
        DOM.scanSpinner.style.display = 'none';
        
        if (data.status === 'success' && data.jobs && data.jobs.length > 0) {
            DOM.scanStatusText.innerHTML = `<span style="color: var(--accent-primary); font-weight: 600;">Success! Found ${data.jobs.length} live UK visa vacancies!</span>`;
            
            data.jobs.forEach(job => {
                const jobRow = document.createElement('div');
                jobRow.className = 'scraped-job-row';
                jobRow.style.cssText = 'padding: 10px; border-radius: 6px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: all 0.2s;';
                
                // Add hover effect
                jobRow.onmouseenter = () => {
                    jobRow.style.background = 'rgba(255,255,255,0.07)';
                    jobRow.style.borderColor = 'var(--accent-primary)';
                };
                jobRow.onmouseleave = () => {
                    jobRow.style.background = 'rgba(255,255,255,0.03)';
                    jobRow.style.borderColor = 'rgba(255,255,255,0.05)';
                };
                
                jobRow.onclick = () => {
                    // Close details modal
                    DOM.detailsModal.style.display = 'none';
                    // Open job details in drawer
                    openJobDrawer(job);
                };
                
                jobRow.innerHTML = `
                    <div style="flex: 1; padding-right: 10px;">
                        <h4 style="margin: 0 0 4px 0; font-size: 13px; font-weight: 600; color: var(--text-primary);">${escapeHTML(job.job_title)}</h4>
                        <span style="font-size: 11px; color: var(--text-muted);">${escapeHTML(job.location || 'United Kingdom')} • ${escapeHTML(job.department || 'General')}</span>
                    </div>
                    <span style="display: flex; align-items: center; color: var(--accent-primary);">
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                    </span>
                `;
                
                DOM.scanJobsList.appendChild(jobRow);
            });
            
            // Refresh main jobs board if we are on jobs tab
            if (state.activeTab === 'jobs') {
                runSearch();
            }
        } else {
            DOM.scanStatusText.innerHTML = `<span style="color: var(--text-muted);">No visa-sponsored roles found on careers site.</span><br><span style="font-size:11px; color: var(--text-muted); display:inline-block; margin-top:4px;">Try searching on LinkedIn or Indeed using links above.</span>`;
        }
    } catch (e) {
        console.error("On-demand crawl error:", e);
        DOM.scanSpinner.style.display = 'none';
        DOM.scanStatusText.innerHTML = `<span style="color: var(--accent-red);">Scanner connection or timeout error.</span>`;
    }
}

// 13. COMPARISONS SYSTEMS
function toggleCompare(sponsor) {
    const idx = state.compareList.findIndex(c => c.id === sponsor.id);
    if (idx > -1) {
        state.compareList.splice(idx, 1);
    } else {
        if (state.compareList.length >= 3) {
            alert("Comparison matrix is capped at a maximum of 3 sponsors.");
            return;
        }
        state.compareList.push(sponsor);
    }
    renderCompareTray();
}

function renderCompareTray() {
    const len = state.compareList.length;
    if (len === 0) {
        DOM.compareBar.style.display = 'none';
        return;
    }
    DOM.compareBar.style.display = 'flex';
    DOM.compareBadgeCount.textContent = `${len} / 3`;
    
    DOM.compareDrawerItems.innerHTML = '';
    state.compareList.forEach(s => {
        const bubble = document.createElement('div');
        bubble.className = 'compare-item-bubble';
        bubble.innerHTML = `
            <span class="compare-bubble-name">${escapeHTML(s.organisation_name)}</span>
            <button class="btn-remove-bubble" onclick="removeCompareItem(${s.id})">&times;</button>
        `;
        DOM.compareDrawerItems.appendChild(bubble);
    });
}

window.removeCompareItem = function(id) {
    state.compareList = state.compareList.filter(c => c.id !== id);
    renderCompareTray();
    
    // Sync modals toggle inner button label if open
    if (DOM.detailsModal.style.display === 'flex') {
        const nameText = DOM.detailsName.textContent;
        const matchingCompare = state.compareList.some(s => s.organisation_name === nameText);
        DOM.detailsModalCompareBtn.innerHTML = matchingCompare ? 'Remove Compare' : 'Add to Compare';
    }
};

function clearCompareTray() {
    state.compareList = [];
    renderCompareTray();
}

function openCompareMatrix() {
    if (state.compareList.length === 0) return;
    DOM.compareMatrixTable.innerHTML = '';
    
    const trHeaders = document.createElement('tr');
    trHeaders.innerHTML = '<th>Feature</th>';
    state.compareList.forEach(s => {
        trHeaders.innerHTML += `<th class="compare-col-header">${escapeHTML(s.organisation_name)}</th>`;
    });
    DOM.compareMatrixTable.appendChild(trHeaders);
    
    const features = [
        { label: 'Town / City', key: 'town_city' },
        { label: 'County', key: 'county' },
        { label: 'Sponsorship Route', key: 'route' },
        { label: 'Licence Rating', key: 'rating' },
        { label: 'Sync Status', key: 'status' }
    ];
    
    features.forEach(f => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${f.label}</td>`;
        
        state.compareList.forEach(s => {
            let val = s[f.key] || '—';
            if (f.key === 'rating') {
                const ratingClass = val.includes('A rating') ? 'badge-rating-a' : 'badge-rating-b';
                val = `<span class="badge-rating ${ratingClass}">${val}</span>`;
            } else if (f.key === 'status') {
                const statusClass = val === 'Active' ? 'badge-active' : val === 'Newly Added' ? 'badge-new' : 'badge-removed';
                val = `<span class="badge-status ${statusClass}">${val}</span>`;
            }
            tr.innerHTML += `<td>${val}</td>`;
        });
        DOM.compareMatrixTable.appendChild(tr);
    });
    
    DOM.compareModal.style.display = 'flex';
}

// 14. LOCAL BOOKMARKS CONTROLLER
function loadBookmarks() {
    const raw = localStorage.getItem('uk_sponsor_bookmarks');
    state.bookmarks = raw ? JSON.parse(raw) : [];
    updateBookmarkBadge();
}

function updateBookmarkBadge() {
    DOM.badgeCountBookmarks.textContent = state.bookmarks.length;
}

window.toggleBookmark = function(sponsor) {
    const idx = state.bookmarks.findIndex(b => b.id === sponsor.id);
    if (idx > -1) {
        state.bookmarks.splice(idx, 1);
    } else {
        state.bookmarks.push(sponsor);
    }
    
    localStorage.setItem('uk_sponsor_bookmarks', JSON.stringify(state.bookmarks));
    updateBookmarkBadge();
    
    if (state.activeTab === 'bookmarks') {
        renderBookmarksTab();
    } else if (state.activeTab === 'sponsors') {
        runSearch();
    }
};

function renderBookmarksTab() {
    DOM.bookmarksEmpty.style.display = state.bookmarks.length === 0 ? 'flex' : 'none';
    DOM.bookmarksTable.style.display = state.bookmarks.length === 0 ? 'none' : 'table';
    DOM.bookmarksTableBody.innerHTML = '';
    
    state.bookmarks.forEach(s => {
        const tr = document.createElement('tr');
        tr.onclick = () => openSponsorDetails(s);
        
        tr.innerHTML = `
            <td class="company-name-cell">${escapeHTML(s.organisation_name)}</td>
            <td>${s.town_city || '—'}</td>
            <td>${s.route}</td>
            <td><span class="badge-rating badge-rating-a">${s.rating}</span></td>
            <td class="align-center">
                <button class="icon-btn-star starred" onclick="event.stopPropagation(); toggleBookmark(${JSON.stringify(s).replace(/"/g, '&quot;')})">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
                        <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
                    </svg>
                </button>
            </td>
        `;
        DOM.bookmarksTableBody.appendChild(tr);
    });
}

// 15. VISUAL METRICS CHARTS RENDERING
function renderAnalyticsCharts() {
    if (!state.analyticsData) return;
    const data = state.analyticsData;
    
    // Top Cities progress
    DOM.chartCitiesList.innerHTML = '';
    const maxCityVal = data.cities_distribution[0] ? data.cities_distribution[0].count : 1;
    data.cities_distribution.forEach(c => {
        const row = document.createElement('div');
        row.className = 'progress-chart-row';
        const pct = (c.count / maxCityVal) * 100;
        
        row.innerHTML = `
            <div class="progress-labels">
                <span class="progress-label-name">${c.town_city}</span>
                <span class="progress-label-val">${c.count.toLocaleString()}</span>
            </div>
            <div class="progress-bar-bg">
                <div class="progress-bar-fill fill-indigo" style="width: ${pct}%"></div>
            </div>
        `;
        DOM.chartCitiesList.appendChild(row);
    });
    
    // Route Distributions progress
    DOM.chartRoutesList.innerHTML = '';
    const maxRouteVal = data.routes_distribution[0] ? data.routes_distribution[0].count : 1;
    data.routes_distribution.forEach(r => {
        const row = document.createElement('div');
        row.className = 'progress-chart-row';
        const pct = (r.count / maxRouteVal) * 100;
        
        row.innerHTML = `
            <div class="progress-labels">
                <span class="progress-label-name">${r.route}</span>
                <span class="progress-label-val">${r.count.toLocaleString()}</span>
            </div>
            <div class="progress-bar-bg">
                <div class="progress-bar-fill fill-emerald" style="width: ${pct}%"></div>
            </div>
        `;
        DOM.chartRoutesList.appendChild(row);
    });
    
    // Compliance breakdown progress
    DOM.chartRatingsList.innerHTML = '';
    const totalCompliance = data.ratings_distribution.reduce((acc, curr) => acc + curr.count, 0) || 1;
    data.ratings_distribution.forEach(rat => {
        const row = document.createElement('div');
        row.className = 'progress-chart-row';
        const pct = ((rat.count / totalCompliance) * 100).toFixed(1);
        
        row.innerHTML = `
            <div class="progress-labels">
                <span class="progress-label-name">${rat.rating}</span>
                <span class="progress-label-val">${rat.count.toLocaleString()} (${pct}%)</span>
            </div>
            <div class="progress-bar-bg">
                <div class="progress-bar-fill fill-amber" style="width: ${pct}%"></div>
            </div>
        `;
        DOM.chartRatingsList.appendChild(row);
    });
    
    // System logs metrics
    DOM.systemLogsList.innerHTML = '';
    if (data.latest_sync) {
        const row = document.createElement('div');
        row.className = 'sys-log-row';
        row.innerHTML = `
            <span class="sys-log-date">${data.latest_sync.sync_date}</span>
            <span class="sys-log-title">Successful database sync arrivals: isolated delta</span>
            <div class="sys-log-metrics">
                <span class="sys-metric-dot"><span class="status-indicator-dot dot-green" style="background:#60a5fa;"></span> Added: ${data.latest_sync.added_count}</span>
                <span class="sys-metric-dot"><span class="status-indicator-dot dot-green" style="background:#f28b82;"></span> Suspended: ${data.latest_sync.removed_count}</span>
            </div>
        `;
        DOM.systemLogsList.appendChild(row);
    } else {
        DOM.systemLogsList.innerHTML = `<div class="sys-log-row"><span class="sys-log-title">No system logs cached inside database.</span></div>`;
    }
}

// 16. MANUAL SYNCHRONIZER
async function triggerManualSync() {
    DOM.manualSyncBtn.disabled = true;
    DOM.manualSyncBtn.querySelector('svg').style.animation = 'spin 1s linear infinite';
    DOM.syncStatusText.textContent = "Syncing with GOV.UK & Crawling Employers...";
    
    try {
        const res = await fetch(`${BACKEND_URL}/api/sync`, { method: 'POST' });
        if (res.ok) {
            alert("Database synchronization and crawls completed successfully!");
            fetchStats();
            runSearch();
        } else {
            alert("Incremental update was bypassed. Database is already fully up to date.");
        }
    } catch (e) {
        console.error("Manual sync failed:", e);
        alert("Failed to establish server connection. Verify server is running.");
    } finally {
        DOM.manualSyncBtn.disabled = false;
        DOM.manualSyncBtn.querySelector('svg').style.animation = 'none';
    }
}

// 17. UI STATE UTILS & HELPERS
function toggleJobsLoading(isLoading) {
    if (isLoading) {
        DOM.jobsGridContainer.innerHTML = `
            <div class="table-placeholder-state" style="grid-column: 1 / -1;">
                <div class="spinner"></div>
                <p>Crawling & loading live jobs board feed...</p>
            </div>
        `;
    }
}

function showJobsError() {
    DOM.jobsGridContainer.innerHTML = `
        <div class="table-placeholder-state" style="grid-column: 1 / -1;">
            <p style="color:var(--accent-red); font-weight:600;">Failed to establish backend server connection.</p>
            <p style="font-size:12px; color:var(--text-muted);">Please verify server.py is running on port 8000.</p>
        </div>
    `;
}

function toggleSponsorsLoading(isLoading) {
    DOM.tableLoading.style.display = isLoading ? 'flex' : 'none';
    if (isLoading) {
        DOM.sponsorTableBody.innerHTML = '';
        DOM.tableEmpty.style.display = 'none';
        DOM.tablePaginationNav.style.display = 'none';
    }
}

function showSponsorsError() {
    DOM.sponsorTableBody.innerHTML = '';
    DOM.tableEmpty.style.display = 'none';
    DOM.tablePlaceholder = document.createElement('div');
    DOM.tablePlaceholder.className = 'table-placeholder-state';
    DOM.tablePlaceholder.innerHTML = `
        <p style="color:var(--accent-red); font-weight:600;">Failed to retrieve records from sponsors registry.</p>
    `;
    DOM.sponsorTableBody.appendChild(DOM.tablePlaceholder);
}

function getDaysAgo(dateStr) {
    if (!dateStr) return 0;
    const diff = Math.abs(new Date() - new Date(dateStr));
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24)) - 1;
    return isNaN(days) ? 0 : days;
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}
