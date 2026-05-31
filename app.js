/* ==========================================================================
   UK SPONSOR RADAR - INTERACTIVE JS FRONTEND ENGINE (FAANG PREMIUM)
   ========================================================================== */

// -------------------------------------------------------------
// ENVIRONMENT CONFIGURATION (SEAMLESS DEV / DEPLOY SWITCHING)
// -------------------------------------------------------------
// Points to localhost during development, and automatically switches to your live 
// Render backend when deployed online. Replace the URL with your actual live Render link!
const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? '' 
    : 'https://uk-sponsor-radar-backend.onrender.com';

// -------------------------------------------------------------
// CORE STATE MANAGEMENT
// -------------------------------------------------------------
let state = {
    activeTab: 'explore', // explore, new, removed, bookmarks, analytics
    searchQuery: '',
    selectedRoute: '',
    selectedRating: '',
    selectedCity: '',
    sortBy: 'organisation_name',
    sortDir: 'asc',
    currentPage: 1,
    limitPerPage: 20,
    bookmarks: [],
    compareList: [] // Array of up to 3 sponsor objects
};

// Search Debouncer and REST Abort Controller
let searchDebounceTimer;
let activeAbortController = null;

// -------------------------------------------------------------
// SELECTORS
// -------------------------------------------------------------
const DOM = {
    // Nav tabs
    tabs: document.querySelectorAll('.tab-trigger'),
    tabExplore: document.getElementById('tab-explore'),
    tabNew: document.getElementById('tab-new'),
    tabRemoved: document.getElementById('tab-removed'),
    tabBookmarks: document.getElementById('tab-bookmarks'),
    tabAnalytics: document.getElementById('tab-analytics'),
    
    // Tab panes
    paneExplore: document.getElementById('content-explore'),
    paneAnalytics: document.getElementById('content-analytics'),
    
    // Dynamic counts
    badgeCountNew: document.getElementById('badge-count-new'),
    badgeCountBookmarks: document.getElementById('badge-count-bookmarks'),
    
    // Stats cards
    statsTotalActive: document.getElementById('stats-total-active'),
    statsNewlyAdded: document.getElementById('stats-newly-added'),
    statsTotalRemoved: document.getElementById('stats-total-removed'),
    statsSkilledWorker: document.getElementById('stats-skilled-worker'),
    statsSkilledWorkerRatio: document.getElementById('stats-skilled-worker-ratio'),
    syncStatusText: document.getElementById('sync-status-text'),
    manualSyncBtn: document.getElementById('manual-sync-btn'),
    
    // Search & Filters panel
    filterPanel: document.getElementById('filter-controls-panel'),
    searchInput: document.getElementById('search-input'),
    searchClearBtn: document.getElementById('search-clear-btn'),
    resetFiltersBtn: document.getElementById('reset-filters-btn'),
    filterRoute: document.getElementById('filter-route'),
    filterRating: document.getElementById('filter-rating'),
    filterCity: document.getElementById('filter-city'),
    filterLimit: document.getElementById('filter-limit'),
    
    // Table listing
    tableBody: document.getElementById('sponsor-table-body'),
    tableLoading: document.getElementById('table-loading'),
    tableEmpty: document.getElementById('table-empty'),
    paginationNav: document.getElementById('table-pagination-nav'),
    paginationSummary: document.getElementById('pagination-summary'),
    pagFirst: document.getElementById('pag-first'),
    pagPrev: document.getElementById('pag-prev'),
    pagNext: document.getElementById('pag-next'),
    pagLast: document.getElementById('pag-last'),
    
    // Table Headers for Sorting
    thName: document.getElementById('th-name'),
    thCity: document.getElementById('th-city'),
    thRoute: document.getElementById('th-route'),
    thRating: document.getElementById('th-rating'),
    
    // Compare Tray Drawer
    compareBar: document.getElementById('compare-bar'),
    compareBadgeCount: document.getElementById('compare-badge-count'),
    compareClearBtn: document.getElementById('compare-clear-btn'),
    compareTriggerBtn: document.getElementById('compare-trigger-btn'),
    compareDrawerItems: document.getElementById('compare-drawer-items'),
    
    // Compare Modal
    compareModal: document.getElementById('compare-modal'),
    compareModalClose: document.getElementById('compare-modal-close'),
    compareMatrixTable: document.getElementById('compare-matrix-table'),
    
    // Details Modal/Drawer
    detailsModal: document.getElementById('details-modal'),
    detailsModalClose: document.getElementById('details-modal-close'),
    detailsStatusBadge: document.getElementById('details-status-badge'),
    detailsName: document.getElementById('details-name'),
    detailsCity: document.getElementById('details-city'),
    detailsCounty: document.getElementById('details-county'),
    detailsRoute: document.getElementById('details-route'),
    detailsRatingBadge: document.getElementById('details-rating-badge'),
    detailsLastSeen: document.getElementById('details-last-seen'),
    
    // Deep links buttons in modal
    btnSearchLinkedin: document.getElementById('btn-search-linkedin'),
    btnSearchIndeed: document.getElementById('btn-search-indeed'),
    btnSearchGlassdoor: document.getElementById('btn-search-glassdoor'),
    btnSearchGoogle: document.getElementById('btn-search-google'),
    detailsModalBookmarkBtn: document.getElementById('details-modal-bookmark-btn'),
    detailsModalCompareBtn: document.getElementById('details-modal-compare-btn'),
    
    // Analytics elements
    chartCitiesList: document.getElementById('chart-cities-list'),
    chartRoutesList: document.getElementById('chart-routes-list'),
    chartRatingsList: document.getElementById('chart-ratings-list')
};

// -------------------------------------------------------------
// EVENT LISTENER WIREUPS
// -------------------------------------------------------------
function initEvents() {
    // Tabs clicking
    DOM.tabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
    
    // Search typing (debounced)
    DOM.searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        DOM.searchClearBtn.style.display = state.searchQuery ? 'block' : 'none';
        
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            state.currentPage = 1;
            loadData();
        }, 250);
    });
    
    // Clear search button
    DOM.searchClearBtn.addEventListener('click', () => {
        DOM.searchInput.value = '';
        state.searchQuery = '';
        DOM.searchClearBtn.style.display = 'none';
        state.currentPage = 1;
        loadData();
    });
    
    // Dropdown filters
    DOM.filterRoute.addEventListener('change', (e) => {
        state.selectedRoute = e.target.value;
        state.currentPage = 1;
        loadData();
    });
    DOM.filterRating.addEventListener('change', (e) => {
        state.selectedRating = e.target.value;
        state.currentPage = 1;
        loadData();
    });
    DOM.filterCity.addEventListener('change', (e) => {
        state.selectedCity = e.target.value;
        state.currentPage = 1;
        loadData();
    });
    DOM.filterLimit.addEventListener('change', (e) => {
        state.limitPerPage = parseInt(e.target.value);
        state.currentPage = 1;
        loadData();
    });
    
    // Reset filters
    DOM.resetFiltersBtn.addEventListener('click', resetFilters);
    
    // Sorting headers
    const sortHeaders = [DOM.thName, DOM.thCity, DOM.thRoute, DOM.thRating];
    sortHeaders.forEach(th => {
        th.addEventListener('click', () => handleSort(th.dataset.sort));
    });
    
    // Pagination clicking
    DOM.pagFirst.addEventListener('click', () => changePage('first'));
    DOM.pagPrev.addEventListener('click', () => changePage('prev'));
    DOM.pagNext.addEventListener('click', () => changePage('next'));
    DOM.pagLast.addEventListener('click', () => changePage('last'));
    
    // Modals closing
    DOM.detailsModalClose.addEventListener('click', () => DOM.detailsModal.style.display = 'none');
    DOM.detailsModal.addEventListener('click', (e) => {
        if (e.target === DOM.detailsModal) DOM.detailsModal.style.display = 'none';
    });
    
    DOM.compareModalClose.addEventListener('click', () => DOM.compareModal.style.display = 'none');
    DOM.compareModal.addEventListener('click', (e) => {
        if (e.target === DOM.compareModal) DOM.compareModal.style.display = 'none';
    });
    
    // Tray clear & compare trigger
    DOM.compareClearBtn.addEventListener('click', clearCompareTray);
    DOM.compareTriggerBtn.addEventListener('click', openCompareMatrix);
    
    // Manual sync button
    DOM.manualSyncBtn.addEventListener('click', triggerManualSync);
}

// -------------------------------------------------------------
// CORE ROUTINES & REST CONNECTIONS
// -------------------------------------------------------------

async function fetchStats() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/stats`);
        const data = await res.json();
        
        // Update metric labels
        DOM.statsTotalActive.textContent = data.total_active.toLocaleString();
        DOM.statsNewlyAdded.textContent = data.newly_added.toLocaleString();
        DOM.badgeCountNew.textContent = data.newly_added;
        DOM.statsTotalRemoved.textContent = data.total_removed.toLocaleString();
        
        // Find skilled worker counts
        const skilledWorkerObj = data.routes_distribution.find(r => r.route === 'Skilled Worker');
        const swCount = skilledWorkerObj ? skilledWorkerObj.count : 0;
        DOM.statsSkilledWorker.textContent = swCount.toLocaleString();
        
        const swRatio = data.total_active > 0 ? ((swCount / data.total_active) * 100).toFixed(1) : 0;
        DOM.statsSkilledWorkerRatio.textContent = `${swRatio}% of all sponsors`;
        
        // Sync badge
        if (data.latest_sync) {
            DOM.syncStatusText.textContent = `GOV.UK Sync: ${data.latest_sync.sync_date}`;
        } else {
            DOM.syncStatusText.textContent = "Offline Database Mode";
        }
        
        // Save analytics info for later rendering
        state.analyticsData = data;
        
        if (state.activeTab === 'analytics') {
            renderAnalyticsCharts();
        }
    } catch (e) {
        console.error("Error loading stats:", e);
    }
}

async function fetchFilterDropdowns() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/filters`);
        const data = await res.json();
        
        // Populate Routes
        DOM.filterRoute.innerHTML = '<option value="">All Sponsorship Routes</option>';
        data.routes.forEach(route => {
            const opt = document.createElement('option');
            opt.value = route;
            opt.textContent = route;
            DOM.filterRoute.appendChild(opt);
        });
        
        // Populate Ratings
        DOM.filterRating.innerHTML = '<option value="">All Licence Ratings</option>';
        data.ratings.forEach(rating => {
            const opt = document.createElement('option');
            opt.value = rating;
            opt.textContent = rating;
            DOM.filterRating.appendChild(opt);
        });
        
        // Populate Cities (Top 50 with counts)
        DOM.filterCity.innerHTML = '<option value="">All Towns & Cities</option>';
        data.top_cities.forEach(cityObj => {
            const opt = document.createElement('option');
            opt.value = cityObj.town_city;
            opt.textContent = `${cityObj.town_city} (${cityObj.count})`;
            DOM.filterCity.appendChild(opt);
        });
    } catch (e) {
        console.error("Error loading filter dropdowns:", e);
    }
}

async function loadData() {
    // Hides search panel on analytics tab
    if (state.activeTab === 'analytics') return;
    
    // Manage Loading indicators
    DOM.tableBody.innerHTML = '';
    DOM.tableEmpty.style.display = 'none';
    DOM.tableLoading.style.display = 'flex';
    DOM.paginationNav.style.opacity = '0.3';
    
    // Handle Bookmarks Tab locally for blistering speed
    if (state.activeTab === 'bookmarks') {
        renderBookmarksTab();
        return;
    }
    
    // Cancel any current active fetching
    if (activeAbortController) {
        activeAbortController.abort();
    }
    activeAbortController = new AbortController();
    
    try {
        // Build query string
        let params = new URLSearchParams({
            q: state.searchQuery,
            route: state.selectedRoute,
            rating: state.selectedRating,
            city: state.selectedCity,
            page: state.currentPage,
            limit: state.limitPerPage,
            sort_by: state.sortBy,
            sort_dir: state.sortDir
        });
        
        // Tab-specific filters
        if (state.activeTab === 'new') {
            params.set('status', 'Newly Added');
        } else if (state.activeTab === 'removed') {
            params.set('status', 'Removed');
        }
        
        const res = await fetch(`${BACKEND_URL}/api/sponsors?${params.toString()}`, {
            signal: activeAbortController.signal
        });
        
        const data = await res.json();
        DOM.tableLoading.style.display = 'none';
        DOM.paginationNav.style.opacity = '1';
        
        renderTableRows(data.sponsors);
        updatePaginationUI(data.meta);
        
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error("Failed to retrieve sponsor dataset:", e);
            DOM.tableLoading.style.display = 'none';
            DOM.tableEmpty.style.display = 'flex';
        }
    }
}

// -------------------------------------------------------------
// TABLE RENDERERS
// -------------------------------------------------------------

function renderTableRows(sponsors) {
    DOM.tableBody.innerHTML = '';
    
    if (!sponsors || sponsors.length === 0) {
        DOM.tableEmpty.style.display = 'flex';
        DOM.paginationNav.style.display = 'none';
        return;
    }
    
    DOM.tableEmpty.style.display = 'none';
    DOM.paginationNav.style.display = 'flex';
    
    sponsors.forEach(s => {
        const tr = document.createElement('tr');
        tr.dataset.id = s.id;
        
        // Name Cell
        const tdName = document.createElement('td');
        tdName.className = 'company-name-cell';
        tdName.textContent = s.organisation_name;
        
        // City Cell
        const tdCity = document.createElement('td');
        tdCity.textContent = s.town_city || '—';
        
        // Route Cell
        const tdRoute = document.createElement('td');
        tdRoute.textContent = s.route;
        
        // Rating Cell
        const tdRating = document.createElement('td');
        const ratingClass = s.rating.includes('A rating') ? 'badge-rating-a' : 'badge-rating-b';
        tdRating.innerHTML = `<span class="badge-rating ${ratingClass}">${s.rating}</span>`;
        
        // Actions Cell
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
                <button class="icon-btn-view" title="Open Sponsor Dashboard">
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
        
        // Wire detail modal clicking
        tr.addEventListener('click', () => openSponsorDetails(s));
        
        DOM.tableBody.appendChild(tr);
    });
}

function updatePaginationUI(meta) {
    DOM.paginationSummary.textContent = `Page ${meta.page} of ${meta.pages || 1}`;
    
    DOM.pagFirst.disabled = meta.page <= 1;
    DOM.pagPrev.disabled = meta.page <= 1;
    DOM.pagNext.disabled = meta.page >= meta.pages;
    DOM.pagLast.disabled = meta.page >= meta.pages;
    
    state.totalPages = meta.pages;
}

function changePage(direction) {
    if (direction === 'first') state.currentPage = 1;
    else if (direction === 'prev' && state.currentPage > 1) state.currentPage--;
    else if (direction === 'next' && state.currentPage < state.totalPages) state.currentPage++;
    else if (direction === 'last') state.currentPage = state.totalPages;
    
    loadData();
}

// -------------------------------------------------------------
// SORTING HANDLERS
// -------------------------------------------------------------
function handleSort(column) {
    // Reset caret symbols
    DOM.thName.querySelector('.sort-icon').textContent = '';
    DOM.thCity.querySelector('.sort-icon').textContent = '';
    DOM.thRoute.querySelector('.sort-icon').textContent = '';
    DOM.thRating.querySelector('.sort-icon').textContent = '';
    
    DOM.thName.classList.remove('active');
    DOM.thCity.classList.remove('active');
    DOM.thRoute.classList.remove('active');
    DOM.thRating.classList.remove('active');
    
    if (state.sortBy === column) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        state.sortBy = column;
        state.sortDir = 'asc';
    }
    
    // Style active sorted header
    const thMap = {
        'organisation_name': DOM.thName,
        'town_city': DOM.thCity,
        'route': DOM.thRoute,
        'rating': DOM.thRating
    };
    
    const activeTh = thMap[column];
    activeTh.classList.add('active');
    activeTh.querySelector('.sort-icon').textContent = state.sortDir === 'desc' ? '▼' : '▲';
    
    state.currentPage = 1;
    loadData();
}

// -------------------------------------------------------------
// TAB SYSTEM ROUTINES
// -------------------------------------------------------------
function switchTab(tabId) {
    state.activeTab = tabId;
    state.currentPage = 1;
    
    // Update active tab buttons
    DOM.tabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabId);
    });
    
    // Show/Hide search filters panel
    if (tabId === 'analytics') {
        DOM.filterPanel.style.display = 'none';
        DOM.paneExplore.classList.remove('active');
        DOM.paneAnalytics.classList.add('active');
        renderAnalyticsCharts();
    } else {
        DOM.filterPanel.style.display = 'flex';
        DOM.paneExplore.classList.add('active');
        DOM.paneAnalytics.classList.remove('active');
        
        // Hide standard filters that don't apply to Removed sponsors
        if (tabId === 'removed') {
            DOM.filterRating.parentElement.style.display = 'none';
        } else {
            DOM.filterRating.parentElement.style.display = 'flex';
        }
        
        loadData();
    }
}

function resetFilters() {
    DOM.searchInput.value = '';
    DOM.filterRoute.value = '';
    DOM.filterRating.value = '';
    DOM.filterCity.value = '';
    DOM.filterLimit.value = '20';
    
    state.searchQuery = '';
    state.selectedRoute = '';
    state.selectedRating = '';
    state.selectedCity = '';
    state.limitPerPage = 20;
    state.currentPage = 1;
    DOM.searchClearBtn.style.display = 'none';
    
    loadData();
}

// -------------------------------------------------------------
// BOOKMARK CONTROLLERS
// -------------------------------------------------------------
function loadBookmarks() {
    const raw = localStorage.getItem('uk_sponsor_bookmarks');
    state.bookmarks = raw ? JSON.parse(raw) : [];
    updateBookmarkBadge();
}

function updateBookmarkBadge() {
    DOM.badgeCountBookmarks.textContent = state.bookmarks.length;
}

window.toggleBookmark = function(sponsor) {
    const index = state.bookmarks.findIndex(b => b.id === sponsor.id);
    
    if (index > -1) {
        state.bookmarks.splice(index, 1);
    } else {
        state.bookmarks.push(sponsor);
    }
    
    localStorage.setItem('uk_sponsor_bookmarks', JSON.stringify(state.bookmarks));
    updateBookmarkBadge();
    
    // Re-render table if on explore or bookmarks tab
    if (state.activeTab === 'bookmarks') {
        renderBookmarksTab();
    } else {
        // Find star button on row and toggle classes
        const rows = DOM.tableBody.querySelectorAll('tr');
        rows.forEach(tr => {
            if (parseInt(tr.dataset.id) === sponsor.id) {
                const btn = tr.querySelector('.icon-btn-star');
                const isStarred = state.bookmarks.some(b => b.id === sponsor.id);
                btn.classList.toggle('starred', isStarred);
                btn.querySelector('svg').setAttribute('fill', isStarred ? 'currentColor' : 'none');
            }
        });
    }
};

function renderBookmarksTab() {
    DOM.tableLoading.style.display = 'none';
    DOM.paginationNav.style.display = 'none'; // No server pagination for local bookmarks
    
    // Client side filter bookmarks based on search and selected options
    let filtered = [...state.bookmarks];
    
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        filtered = filtered.filter(b => b.organisation_name.toLowerCase().includes(q));
    }
    if (state.selectedRoute) {
        filtered = filtered.filter(b => b.route === state.selectedRoute);
    }
    if (state.selectedRating) {
        filtered = filtered.filter(b => b.rating === state.selectedRating);
    }
    if (state.selectedCity) {
        filtered = filtered.filter(b => b.town_city === state.selectedCity);
    }
    
    renderTableRows(filtered);
}

// -------------------------------------------------------------
// SPONSOR COMPARE CONTROLLERS
// -------------------------------------------------------------
function toggleCompare(sponsor) {
    const idx = state.compareList.findIndex(c => c.id === sponsor.id);
    
    if (idx > -1) {
        // Remove
        state.compareList.splice(idx, 1);
    } else {
        // Add (Max 3)
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
            <span class="compare-bubble-name">${s.organisation_name}</span>
            <button class="btn-remove-bubble" onclick="removeCompareItem(${s.id})">&times;</button>
        `;
        DOM.compareDrawerItems.appendChild(bubble);
    });
}

window.removeCompareItem = function(id) {
    state.compareList = state.compareList.filter(c => c.id !== id);
    renderCompareTray();
    
    // Update details modal button if active
    if (DOM.detailsModal.style.display === 'flex') {
        const nameText = DOM.detailsName.textContent;
        const matchingSponsor = state.compareList.some(s => s.organisation_name === nameText);
        DOM.detailsModalCompareBtn.classList.toggle('btn-indigo', !matchingSponsor);
        DOM.detailsModalCompareBtn.classList.toggle('btn-outline', matchingSponsor);
        DOM.detailsModalCompareBtn.innerHTML = matchingSponsor ? 'Added to Compare' : 'Add to Compare';
    }
};

function clearCompareTray() {
    state.compareList = [];
    renderCompareTray();
}

function openCompareMatrix() {
    if (state.compareList.length === 0) return;
    
    DOM.compareMatrixTable.innerHTML = '';
    DOM.compareModal.style.display = 'flex';
    
    // Table Headers
    const trHeaders = document.createElement('tr');
    trHeaders.innerHTML = '<th>Feature</th>';
    state.compareList.forEach(s => {
        trHeaders.innerHTML += `<th class="compare-col-header">${s.organisation_name}</th>`;
    });
    DOM.compareMatrixTable.appendChild(trHeaders);
    
    // Feature rows definitions
    const features = [
        { label: 'Town / City', key: 'town_city' },
        { label: 'County', key: 'county' },
        { label: 'Sponsorship Route', key: 'route' },
        { label: 'Compliance Rating', key: 'rating' },
        { label: 'Licence Status', key: 'status' }
    ];
    
    features.forEach(f => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${f.label}</td>`;
        
        state.compareList.forEach(s => {
            let val = s[f.key] || '—';
            
            // Format badges for Rating and Status
            if (f.key === 'rating') {
                const ratingClass = val.includes('A rating') ? 'badge-rating-a' : 'badge-rating-b';
                val = `<span class="badge-rating ${ratingClass}">${val}</span>`;
            } else if (f.key === 'status') {
                const statusClass = val === 'Newly Added' ? 'badge-new' : (val === 'Removed' ? 'badge-removed' : 'badge-active');
                val = `<span class="badge-status ${statusClass}">${val}</span>`;
            }
            
            tr.innerHTML += `<td>${val}</td>`;
        });
        
        DOM.compareMatrixTable.appendChild(tr);
    });
    
    // Add Row for Quick Job Research platform links
    const trResearch = document.createElement('tr');
    trResearch.innerHTML = '<td>Job Search Hub</td>';
    state.compareList.forEach(s => {
        const ln = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(s.organisation_name + ' UK')}`;
        const ind = `https://uk.indeed.com/jobs?q=${encodeURIComponent(s.organisation_name)}`;
        const gd = `https://www.glassdoor.co.uk/Search/results.htm?keyword=${encodeURIComponent(s.organisation_name)}`;
        
        trResearch.innerHTML += `
            <td>
                <div class="compare-research-actions">
                    <a href="${ln}" target="_blank" class="research-btn btn-linkedin" style="padding:8px">LinkedIn</a>
                    <a href="${ind}" target="_blank" class="research-btn btn-indeed" style="padding:8px">Indeed</a>
                    <a href="${gd}" target="_blank" class="research-btn btn-glassdoor" style="padding:8px">Glassdoor</a>
                </div>
            </td>
        `;
    });
    DOM.compareMatrixTable.appendChild(trResearch);
}

// -------------------------------------------------------------
// DETAIL MODAL DRAWER
// -------------------------------------------------------------
function openSponsorDetails(sponsor) {
    DOM.detailsModal.style.display = 'flex';
    
    // Fill texts
    DOM.detailsName.textContent = sponsor.organisation_name;
    DOM.detailsCity.textContent = sponsor.town_city || '—';
    DOM.detailsCounty.textContent = sponsor.county || '—';
    DOM.detailsRoute.textContent = sponsor.route;
    DOM.detailsLastSeen.textContent = sponsor.last_seen || '—';
    
    // Rating badge style
    const ratingText = sponsor.rating;
    DOM.detailsRatingBadge.textContent = ratingText;
    DOM.detailsRatingBadge.className = 'info-val badge-rating ' + (ratingText.includes('A rating') ? 'badge-rating-a' : 'badge-rating-b');
    
    // Status style
    const status = sponsor.status;
    DOM.detailsStatusBadge.textContent = status;
    DOM.detailsStatusBadge.className = 'badge-status-lg ' + (status === 'Newly Added' ? 'badge-new' : (status === 'Removed' ? 'badge-removed' : 'badge-active'));
    
    // Configure Job Research platform buttons URLs
    DOM.btnSearchLinkedin.href = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(sponsor.organisation_name + ' UK')}`;
    DOM.btnSearchIndeed.href = `https://uk.indeed.com/jobs?q=${encodeURIComponent(sponsor.organisation_name)}`;
    DOM.btnSearchGlassdoor.href = `https://www.glassdoor.co.uk/Search/results.htm?keyword=${encodeURIComponent(sponsor.organisation_name)}`;
    DOM.btnSearchGoogle.href = `https://www.google.com/search?q=${encodeURIComponent(sponsor.organisation_name + ' UK corporate website')}`;
    
    // Star toggle button
    const isStarred = state.bookmarks.some(b => b.id === sponsor.id);
    DOM.detailsModalBookmarkBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="${isStarred ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>
        </svg>
        ${isStarred ? 'Bookmarked' : 'Bookmark Sponsor'}
    `;
    DOM.detailsModalBookmarkBtn.className = isStarred ? 'btn btn-outline-indigo' : 'btn btn-outline-indigo';
    DOM.detailsModalBookmarkBtn.onclick = () => {
        toggleBookmark(sponsor);
        openSponsorDetails(sponsor); // Reload button state in modal
    };
    
    // Compare button state toggle
    const inCompare = state.compareList.some(c => c.id === sponsor.id);
    DOM.detailsModalCompareBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 21v-8"/><path d="M21 21H3"/></svg>
        ${inCompare ? 'Added to Compare' : 'Add to Compare'}
    `;
    DOM.detailsModalCompareBtn.className = inCompare ? 'btn btn-outline' : 'btn btn-indigo';
    DOM.detailsModalCompareBtn.onclick = () => {
        toggleCompare(sponsor);
        openSponsorDetails(sponsor); // Reload button state
    };
}

// -------------------------------------------------------------
// ANALYTICS PROGRESS CHARTS
// -------------------------------------------------------------
function renderAnalyticsCharts() {
    const data = state.analyticsData;
    if (!data) return;
    
    // Render top cities
    DOM.chartCitiesList.innerHTML = '';
    if (data.cities_distribution && data.cities_distribution.length > 0) {
        const maxCity = data.cities_distribution[0].count;
        data.cities_distribution.forEach(c => {
            const pct = maxCity > 0 ? ((c.count / maxCity) * 100) : 0;
            const row = document.createElement('div');
            row.className = 'progress-chart-row';
            row.innerHTML = `
                <div class="progress-labels">
                    <span class="progress-label-name">${c.town_city}</span>
                    <span class="progress-label-val">${c.count.toLocaleString()}</span>
                </div>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill fill-indigo" style="width: 0%" data-width="${pct}%"></div>
                </div>
            `;
            DOM.chartCitiesList.appendChild(row);
        });
    }
    
    // Render routes
    DOM.chartRoutesList.innerHTML = '';
    if (data.routes_distribution && data.routes_distribution.length > 0) {
        const maxRoute = data.routes_distribution[0].count;
        data.routes_distribution.forEach(r => {
            const pct = maxRoute > 0 ? ((r.count / maxRoute) * 100) : 0;
            const row = document.createElement('div');
            row.className = 'progress-chart-row';
            row.innerHTML = `
                <div class="progress-labels">
                    <span class="progress-label-name">${r.route}</span>
                    <span class="progress-label-val">${r.count.toLocaleString()}</span>
                </div>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill fill-violet" style="width: 0%" data-width="${pct}%"></div>
                </div>
            `;
            DOM.chartRoutesList.appendChild(row);
        });
    }
    
    // Render ratings breakdown
    DOM.chartRatingsList.innerHTML = '';
    if (data.ratings_distribution && data.ratings_distribution.length > 0) {
        DOM.chartRatingsList.className = 'rating-pie-grid';
        data.ratings_distribution.forEach(r => {
            const pct = data.total_active > 0 ? ((r.count / data.total_active) * 100).toFixed(1) : 0;
            const row = document.createElement('div');
            row.className = 'rating-bar-group';
            
            const fillType = r.rating.includes('A rating') ? 'fill-emerald' : 'fill-amber';
            const labelClass = r.rating.includes('A rating') ? 'text-emerald' : 'text-amber';
            
            row.innerHTML = `
                <div class="rating-percent-block ${labelClass}">${pct}%</div>
                <div style="flex:1">
                    <div class="progress-labels" style="margin-bottom:4px">
                        <span class="progress-label-name">${r.rating}</span>
                        <span class="progress-label-val">${r.count.toLocaleString()}</span>
                    </div>
                    <div class="progress-bar-bg">
                        <div class="progress-bar-fill ${fillType}" style="width: 0%" data-width="${pct}%"></div>
                    </div>
                </div>
            `;
            DOM.chartRatingsList.appendChild(row);
        });
    }
    
    // System log rendering removed
    
    // Small timeout to trigger animated transitions width fills beautifully!
    setTimeout(() => {
        const fills = document.querySelectorAll('.progress-bar-fill');
        fills.forEach(fill => {
            fill.style.width = fill.dataset.width;
        });
    }, 100);
}

// -------------------------------------------------------------
// DYNAMIC MANUAL DATABASE RE-SYNC
// -------------------------------------------------------------
async function triggerManualSync() {
    DOM.manualSyncBtn.classList.add('animate-spin');
    DOM.syncStatusText.textContent = "Downloading live CSV from GOV.UK...";
    
    try {
        const res = await fetch(`${BACKEND_URL}/api/sync`, { method: 'POST' });
        const data = await res.json();
        
        DOM.manualSyncBtn.classList.remove('animate-spin');
        
        if (data.status === 'success') {
            alert("Database re-sync completed successfully! Live additions and suspensions calculated.");
            fetchStats();
            loadData();
        } else {
            alert("Failed to sync database. GOV.UK may be rate limiting or offline. Try again later.");
            DOM.syncStatusText.textContent = "Sync failed. Offline mode active.";
        }
    } catch(e) {
        console.error("Sync error:", e);
        DOM.manualSyncBtn.classList.remove('animate-spin');
        alert("Failed to connect to sync server. Verify server is running.");
        DOM.syncStatusText.textContent = "Server Connection Offline";
    }
}

// -------------------------------------------------------------
// INITIALIZER
// -------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
    // Inject spin css for manual sync button
    const style = document.createElement('style');
    style.innerHTML = `
        .animate-spin svg {
            animation: spin 1s linear infinite;
        }
    `;
    document.head.appendChild(style);
    
    initEvents();
    loadBookmarks();
    fetchStats();
    fetchFilterDropdowns();
    loadData();
});
