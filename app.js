// =====================================================================
// 0. Supabase 연결 설정
// =====================================================================
const SUPABASE_URL = 'https://dwejbbhrjfcqcnslheas.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR3ZWpiYmhyamZjcWNuc2xoZWFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MzI3NzUsImV4cCI6MjEwNTEwODc3NX0.hi7BImksiFdYDk38er28OF-J0oliFfpcc0HxUFSSocw';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const mapDB = supabaseClient;

let currentUser = null;
let allReviews = [];
let currentReviewId = null;
let kakaoMap = null;
let activeInfoWindow = null; 
let gpsMarker = null;

let currentSearchKeyword = ''; // 💡 현재 검색 상태 저장용 변수
const RECENT_SEARCH_KEY = 'pothole_recent_searches'; // 💡 최근 검색어 저장 키

const RETURN_KEY = 'pothole_return_view';
const RETURN_TTL = 10 * 60 * 1000;
const PLACEHOLDER_LOGIN = 'https://cdn-icons-png.flaticon.com/512/847/847969.png';

// =====================================================================
// 1. 화면 전환
// =====================================================================
function go(view, opts = {}) {
  if (view === 'write' && !currentUser) {
    showAlert('로그인 후 이용 가능합니다!', () => { go('mypage'); });
    return;
  }

  closeInfoWindow();

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(view + '-view').classList.add('active');

  // 💡 검색(search) 화면도 게시판(board) 네비게이션으로 묶어줌
  const navKey = (view === 'detail' || view === 'write' || view === 'search') ? 'board' : view;
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === navKey);
  });

  window.scrollTo(0, 0);
  refreshNav();

  if (view === 'map') {
    if (kakaoMap) kakaoMap.relayout();
  } else if (view === 'board') {
    currentReviewId = null;
    loadReviews();
  } else if (view === 'write') {
    resetWriteForm(opts.review || null);
  } else if (view === 'mypage') {
    renderMyPage();
  }
}

function refreshNav() {
  const nav = document.getElementById('bottom-nav');
  if (!nav) return;
  nav.style.display = 'none';
  void nav.offsetHeight;
  nav.style.display = '';
}

document.addEventListener('focusout', () => setTimeout(refreshNav, 100));
document.addEventListener('change', (e) => {
  if (e.target.type === 'file') setTimeout(refreshNav, 100);
});
window.addEventListener('pageshow', refreshNav);
window.addEventListener('focus', refreshNav);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => setTimeout(refreshNav, 100));
}

// =====================================================================
// 2. 지도 및 라즈베리파이 GPS 연동
// =====================================================================
const MARKER_IMAGES = { '발견': './red_pin.svg', '수리중': './blue_pin.svg' };

function closeInfoWindow() {
  if (activeInfoWindow) { activeInfoWindow.close(); activeInfoWindow = null; }
}

kakao.maps.load(function () {
  const container = document.getElementById('map');
  kakaoMap = new kakao.maps.Map(container, {
    center: new kakao.maps.LatLng(37.5665, 126.9780),
    level: 5
  });

  kakao.maps.event.addListener(kakaoMap, 'click', closeInfoWindow);
  kakao.maps.event.addListener(kakaoMap, 'dragstart', closeInfoWindow);
  kakao.maps.event.addListener(kakaoMap, 'zoom_start', closeInfoWindow);

  fetchAndDisplayPotholes(kakaoMap);
  fetchLatestGpsLog();
  subscribeGpsLogs();
});

async function fetchAndDisplayPotholes(map) {
  const { data, error } = await mapDB.from('potholes').select('*');
  if (error) return;

  const todayString = toDateString(new Date());
  let todayPotholeCount = 0;

  data.forEach(item => {
    const position = new kakao.maps.LatLng(parseFloat(item.latitude), parseFloat(item.longitude));
    const status = item.status === '수리중' ? '수리중' : '발견';
    const markerImage = new kakao.maps.MarkerImage(MARKER_IMAGES[status], new kakao.maps.Size(30, 30));
    const marker = new kakao.maps.Marker({ position, image: markerImage });
    marker.setMap(map);

    const badgeColor = status === '발견' ? '#EF4444' : '#3B82F6';
    const timeString = item.created_at ? new Date(item.created_at).toLocaleString() : '시간 정보 없음';
    const imageTag = item.image_url ? `<img src="${item.image_url}" style="width:100%; height:100px; object-fit:cover; margin-top:8px; border-radius:4px;">` : '';

    const iwContent = `
      <div style="padding:10px; font-size:12px; min-width:160px; max-width:200px;">
        <span style="background-color:${badgeColor}; color:white; padding:2px 6px; border-radius:4px;">${status}</span>
        <strong style="display:block; margin-top:6px; font-size:13px;">${item.title}</strong>
        ${imageTag}
        <p style="margin:4px 0 0 0; color:#666;">${item.description || '상세 내용 없음'}</p>
        <p style="margin:6px 0 0 0; color:#888; font-size:11px;">발견: ${timeString}</p>
      </div>
    `;

    const infowindow = new kakao.maps.InfoWindow({ content: iwContent, removable: false });
    kakao.maps.event.addListener(marker, 'click', function () {
      if (activeInfoWindow === infowindow) { closeInfoWindow(); return; }
      closeInfoWindow(); infowindow.open(map, marker); activeInfoWindow = infowindow;
    });

    if (item.created_at && toDateString(new Date(item.created_at)) === todayString) todayPotholeCount++;
  });

  document.getElementById('today-count').innerText = todayPotholeCount;
}

async function fetchLatestGpsLog() {
  const { data, error } = await supabaseClient.from('gps_logs').select('*').order('created_at', { ascending: false }).limit(1);
  if (!error && data.length > 0) updateGpsMarker(data[0].lat, data[0].lon);
}

function updateGpsMarker(lat, lon) {
  const position = new kakao.maps.LatLng(lat, lon);
  if (gpsMarker) gpsMarker.setPosition(position);
  else {
    gpsMarker = new kakao.maps.Marker({ position: position, image: new kakao.maps.MarkerImage('./blue_pin.svg', new kakao.maps.Size(30, 30)) });
    gpsMarker.setMap(kakaoMap);
  }
  kakaoMap.panTo(position);
}

function subscribeGpsLogs() {
  supabaseClient.channel('public:gps_logs').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'gps_logs' }, payload => {
    updateGpsMarker(payload.new.lat, payload.new.lon);
  }).subscribe();
}

function toDateString(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// =====================================================================
// 3. 공통 알림 / 확인 팝업
// =====================================================================
function showAlert(message, callback = null) {
  return new Promise(resolve => {
    const modal = document.getElementById('custom-modal');
    document.getElementById('modal-message').innerText = message;
    document.getElementById('modal-buttons').innerHTML = `<button class="btn" onclick="closeModal()">확인</button>`;
    modal.style.display = 'flex';
    window.closeModal = () => { modal.style.display = 'none'; if (callback) callback(); resolve(); };
  });
}

function showConfirm(message) {
  return new Promise(resolve => {
    const modal = document.getElementById('custom-modal');
    document.getElementById('modal-message').innerText = message;
    document.getElementById('modal-buttons').innerHTML = `
      <button class="btn" onclick="handleConfirm(true)">확인</button>
      <button class="btn btn-gray" onclick="handleConfirm(false)">취소</button>
    `;
    modal.style.display = 'flex';
    window.handleConfirm = (result) => { modal.style.display = 'none'; resolve(result); };
  });
}

// =====================================================================
// 4. 로그인 및 사용자 정보 불러오기 유틸
// =====================================================================
async function checkUser() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  currentUser = session ? session.user : null;
  renderAuthBar();
  renderMyPage();
}

function getUserName(user) { return user ? (user.user_metadata.name || user.user_metadata.full_name || '사용자') : '익명'; }
function getUserAvatar(user) { return user ? (user.user_metadata.avatar_url || PLACEHOLDER_LOGIN) : PLACEHOLDER_LOGIN; }
function escapeText(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function authorOf(item) { return escapeText(item.author_name || '익명'); }
function avatarOf(item) { return item.author_avatar_url || PLACEHOLDER_LOGIN; }

function saveReturnView() {
  const current = document.querySelector('.view.active');
  const view = current ? current.id.replace('-view', '') : 'map';
  try { localStorage.setItem(RETURN_KEY, JSON.stringify({ view, reviewId: view === 'detail' ? currentReviewId : null, time: Date.now() })); } catch (e) {}
}

function popReturnView() {
  try {
    const raw = localStorage.getItem(RETURN_KEY);
    localStorage.removeItem(RETURN_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (Date.now() - saved.time > RETURN_TTL) return null;
    return saved;
  } catch (e) { return null; }
}

async function loginWithKakao() {
  saveReturnView();
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'kakao', options: { redirectTo: window.location.origin + window.location.pathname, queryParams: { scope: 'profile_nickname,profile_image' } }
  });
  if (error) await showAlert('로그인 실패: ' + error.message);
}

async function logout() { saveReturnView(); await supabaseClient.auth.signOut(); window.location.reload(); }

function renderAuthBar() {
  const statusDiv = document.getElementById('user-status');
  const btnBox = document.getElementById('auth-btn-container');
  if (!statusDiv || !btnBox) return;

  if (currentUser) {
    statusDiv.innerHTML = `👤 <b>${escapeText(getUserName(currentUser))}</b>님 환영합니다!`;
    btnBox.innerHTML = `<button class="btn btn-gray btn-sm" onclick="logout()">로그아웃</button>`;
  } else {
    statusDiv.innerHTML = '로그인이 필요합니다.';
    btnBox.innerHTML = `<button class="btn btn-kakao btn-sm" onclick="loginWithKakao()">💬 카카오 로그인</button>`;
  }
}

// =====================================================================
// 5. 게시판 및 새로운 전체화면 검색 기능
// =====================================================================
async function loadReviews() {
  const { data, error } = await mapDB.from('pothole_reviews').select('*').order('created_at', { ascending: false });
  if (error) { document.getElementById('review-list').innerHTML = '후기를 불러오지 못했습니다.'; return; }
  allReviews = data;
  
  const indicator = document.getElementById('search-indicator');
  
  // 💡 검색어가 저장되어 있으면 필터링해서 보여주고, 아니면 전체를 보여줌
  if (currentSearchKeyword) {
    if (indicator) {
      document.getElementById('current-keyword').innerText = currentSearchKeyword;
      indicator.style.display = 'block';
    }
    const filtered = allReviews.filter(r =>
      (r.title || '').toLowerCase().includes(currentSearchKeyword) || (r.location || '').toLowerCase().includes(currentSearchKeyword) ||
      (r.content || '').toLowerCase().includes(currentSearchKeyword) || (r.author_name || '').toLowerCase().includes(currentSearchKeyword)
    );
    displayReviews(filtered);
  } else {
    if (indicator) indicator.style.display = 'none';
    displayReviews(allReviews);
  }
}
function displayReviews(reviews) {
  const listDiv = document.getElementById('review-list');
  if (reviews.length === 0) { listDiv.innerHTML = '<p style="text-align:center; color:#888; padding:20px;">검색된 후기가 없습니다.</p>'; return; }
  
  // 💡 목록 화면: 위치를 제목 위쪽에 작게 띄우고, 그 아래 제목 -> 내용(2줄) -> 날짜 순으로 배치
  listDiv.innerHTML = reviews.map(review => {
    const dateStr = review.created_at ? review.created_at.substring(0, 10) : '';
    const contentPreview = escapeText(review.content || '');
    const locationText = review.location ? escapeText(review.location) : '';
    
    // 위치 정보가 있을 때 제목 위에 작게 표시할 HTML
    const locationHtml = locationText 
      ? `<div style="font-size: 12px; color: #007BA7; font-weight: 500; margin-bottom: 2px;">📍 ${locationText}</div>` 
      : '';

    const thumbnailHtml = review.image_url 
      ? `<img src="${review.image_url}" style="width:68px; height:68px; object-fit:cover; border-radius:8px; flex-shrink:0; border:1px solid #eee;">` 
      : '';
    
    return `
      <div class="review-item" onclick="showDetailView(${review.id})" style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
        <div style="display:flex; flex-direction:column; flex:1; min-width:0; gap:4px;">
          ${locationHtml}
          <div style="font-weight:bold; font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; width:100%;">
            ${review.title}
          </div>
          <div style="font-size:13px; color:#555; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; text-overflow:ellipsis; white-space:normal; line-height:1.4;">
            ${contentPreview}
          </div>
          <div style="font-size:12px; color:#888; margin-top:2px;">
            ${dateStr}
          </div>
        </div>
        ${thumbnailHtml}
      </div>
    `;
  }).join('');
}

// 💡 1. 돋보기 버튼을 누르면 검색 화면으로 이동
function openSearchView() {
  go('search');
  const searchInput = document.getElementById('real-search-input');
  searchInput.value = currentSearchKeyword || '';
  setTimeout(() => searchInput.focus(), 100);
  renderRecentSearches();
}

// 💡 2. 로컬 스토리지에서 최근 검색어 불러오기
function getRecentSearches() {
  try { return JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY)) || []; } 
  catch (e) { return []; }
}

// 💡 3. 최근 검색어 저장 (최대 10개)
function saveRecentSearch(keyword) {
  if (!keyword) return;
  let searches = getRecentSearches();
  searches = searches.filter(k => k !== keyword); // 중복 제거
  searches.unshift(keyword); // 맨 앞에 추가
  if (searches.length > 10) searches.pop();
  localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(searches));
}

// 💡 4. 특정 검색어 삭제 (X 버튼)
function removeRecentSearch(keyword) {
  let searches = getRecentSearches();
  searches = searches.filter(k => k !== keyword);
  localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(searches));
  renderRecentSearches();
}

// 💡 5. 최근 검색어 목록을 화면에 렌더링
function renderRecentSearches() {
  const listDiv = document.getElementById('recent-search-list');
  const searches = getRecentSearches();
  if (searches.length === 0) {
    listDiv.innerHTML = '<div style="color: #888; font-size: 13px;">최근 검색어가 없습니다.</div>';
    return;
  }
  listDiv.innerHTML = searches.map(keyword => `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; font-size: 15px;">
      <div style="display: flex; align-items: center; gap: 10px; cursor: pointer; flex: 1;" onclick="executeSearch('${escapeHtml(keyword)}')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        <span>${escapeHtml(keyword)}</span>
      </div>
      <button onclick="removeRecentSearch('${escapeHtml(keyword)}')" style="background: none; border: none; color: #999; cursor: pointer; font-size: 20px; padding: 0 5px;">×</button>
    </div>
  `).join('');
}

// 💡 6. 검색 실행 (입력 후 엔터 or 최근 검색어 클릭 시)
function executeSearch(keyword = null) {
  const finalKeyword = keyword !== null ? keyword : document.getElementById('real-search-input').value.trim();
  
  if (!finalKeyword) {
    clearSearch();
    go('board');
    return;
  }
  
  saveRecentSearch(finalKeyword); // 최근 검색어 저장
  currentSearchKeyword = finalKeyword.toLowerCase();
  
  go('board'); // 게시판 화면으로 돌아가서 결과 표시
}

// 💡 7. 검색어 초기화
function clearSearch() {
  currentSearchKeyword = '';
  const indicator = document.getElementById('search-indicator');
  if (indicator) indicator.style.display = 'none';
  displayReviews(allReviews);
}


function showDetailView(id) {
  const review = allReviews.find(r => r.id === id);
  if (!review) return;
  go('detail');
  currentReviewId = review.id;

  const actions = document.getElementById('author-actions');
  const isAuthor = currentUser && review.user_id === currentUser.id;

  actions.innerHTML = `
    <div style="position:relative; display:inline-block;">
      <button onclick="toggleDetailMenu()" style="background:none; border:none; font-size:22px; padding:0 5px; cursor:pointer; color:#555; font-weight:bold;">⋮</button>
      <div id="detail-menu" style="display:none; position:absolute; right:0; top:35px; background:white; border:1px solid #ddd; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.1); z-index:100; min-width:110px; overflow:hidden; flex-direction:column; text-align:center;">
        ${isAuthor ? `
          <div onclick="editReview(${review.id}); toggleDetailMenu();" style="padding:12px; border-bottom:1px solid #eee; cursor:pointer; font-size:14px; background:#fff;" onmouseover="this.style.background='#f9f9f9'" onmouseout="this.style.background='#fff'">수정</div>
          <div onclick="deleteReview(${review.id}); toggleDetailMenu();" style="padding:12px; border-bottom:1px solid #eee; cursor:pointer; font-size:14px; color:#d9534f; background:#fff;" onmouseover="this.style.background='#fcf2f2'" onmouseout="this.style.background='#fff'">삭제</div>
        ` : ''}
        <div onclick="shareUrl(${review.id}); toggleDetailMenu();" style="padding:12px; cursor:pointer; font-size:14px; background:#fff;" onmouseover="this.style.background='#f9f9f9'" onmouseout="this.style.background='#fff'">URL 공유</div>
      </div>
    </div>
  `;

  const imgHtml = review.image_url ? `<img src="${review.image_url}" class="review-img" style="max-width:100%; margin-top:15px; border-radius:8px;">` : '';
  const detailDateStr = review.created_at ? review.created_at.substring(0, 10) : '';

  document.getElementById('detail-content').innerHTML = `
    <div style="display:flex; align-items:center; margin-bottom:15px;">
      <img src="${avatarOf(review)}" style="width:44px; height:44px; border-radius:50%; margin-right:12px; object-fit:cover; background:#eee;" alt="프로필">
      <div>
        <div style="color:#333; font-size:15px; font-weight:bold;">${authorOf(review)}</div>
        <div style="color:#888; font-size:12px;">${detailDateStr}</div>
      </div>
    </div>
    <h3 style="margin-top:0; margin-bottom:8px; color:#007BA7;">${review.title}</h3>
    <p style="color:#666; font-size:14px; margin-bottom:10px;">위치: ${review.location}</p>
    <hr class="divider" style="margin-top:0;">
    <p style="line-height:1.6; white-space:pre-line;">${review.content}</p>
    ${imgHtml}
  `;

  loadComments(review.id);
}

function toggleDetailMenu() {
  const menu = document.getElementById('detail-menu');
  if (menu) menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
}

document.addEventListener('click', function(e) {
  const menu = document.getElementById('detail-menu');
  if (menu && menu.style.display === 'flex' && !e.target.closest('#author-actions')) {
    menu.style.display = 'none';
  }
});

async function shareUrl(id) {
  const shareLink = window.location.origin + window.location.pathname + '?review=' + id;
  try {
    await navigator.clipboard.writeText(shareLink);
    showAlert('✅ 링크가 클립보드에 복사되었습니다!');
  } catch (err) {
    const tempInput = document.createElement('input');
    tempInput.value = shareLink;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand('copy');
    document.body.removeChild(tempInput);
    showAlert('✅ 링크가 클립보드에 복사되었습니다!');
  }
}

function editReview(id) { const review = allReviews.find(r => r.id === id); if (review) go('write', { review }); }

function resetWriteForm(review) {
  document.getElementById('form-title').innerText = review ? '후기 수정하기' : '새로운 후기 작성하기';
  document.getElementById('edit-id').value = review ? review.id : '';
  document.getElementById('title').value = review ? review.title : '';
  document.getElementById('location').value = review ? review.location : '';
  document.getElementById('content').value = review ? review.content : '';
  document.getElementById('imageFile').value = '';
}

async function saveReview() {
  if (!currentUser) { await showAlert('로그인이 필요합니다!', () => { go('mypage'); }); return; }

  const editId = document.getElementById('edit-id').value;
  const title = document.getElementById('title').value;
  const location = document.getElementById('location').value;
  const content = document.getElementById('content').value;
  const imageInput = document.getElementById('imageFile');

  if (!title || !location || !content) { await showAlert('제목, 위치, 내용은 필수 입력 항목입니다!'); return; }

  let imageUrl = '';
  if (imageInput.files.length > 0) {
    const file = imageInput.files[0];
    const fileName = `${Date.now()}.${file.name.split('.').pop()}`;
    const { error: uploadError } = await mapDB.storage.from('review-images').upload(fileName, file);
    if (uploadError) { await showAlert('이미지 업로드 실패: ' + uploadError.message); return; }
    imageUrl = mapDB.storage.from('review-images').getPublicUrl(fileName).data.publicUrl;
  }

  const authorName = getUserName(currentUser);
  const authorAvatarUrl = getUserAvatar(currentUser);

  if (editId) {
    const updateData = { title, location, content, author_name: authorName, author_avatar_url: authorAvatarUrl };
    if (imageUrl) updateData.image_url = imageUrl;
    const { error } = await mapDB.from('pothole_reviews').update(updateData).eq('id', editId);
    if (error) { await showAlert('후기 수정 실패: ' + error.message); return; }
    await showAlert('후기가 수정되었습니다!');
  } else {
    const { error } = await mapDB.from('pothole_reviews').insert([{ 
      title, location, content, image_url: imageUrl, user_id: currentUser.id, author_name: authorName, author_avatar_url: authorAvatarUrl 
    }]);
    if (error) { await showAlert('후기 등록 실패: ' + error.message); return; }
    await showAlert('후기가 성공적으로 등록되었습니다!');
  }
  go('board');
}

async function deleteReview(reviewId) {
  if (!await showConfirm('정말 이 후기를 삭제하시겠습니까?')) return;
  const { error } = await mapDB.from('pothole_reviews').delete().eq('id', reviewId);
  if (error) await showAlert('삭제 실패: ' + error.message); else { await showAlert('후기가 삭제되었습니다.'); go('board'); }
}

// =====================================================================
// 6. 댓글 / 답글 
// =====================================================================
async function loadComments(reviewId) {
  const listDiv = document.getElementById('comment-list');
  listDiv.innerHTML = '불러오는 중...';

  const { data, error } = await mapDB.from('pothole_comments').select('*').eq('review_id', reviewId).order('created_at', { ascending: true });
  if (error) { listDiv.innerHTML = '댓글을 불러오지 못했습니다.'; return; }
  if (data.length === 0) { listDiv.innerHTML = '<p style="color:#888; font-size:14px;">작성된 댓글이 없습니다. 첫 댓글을 남겨보세요!</p>'; return; }

  const topComments = data.filter(c => !c.parent_id);
  const replies = data.filter(c => c.parent_id);
  const ownerActions = (c) => (currentUser && c.user_id === currentUser.id) ? `<button class="link-btn" style="color:#f0ad4e;" onclick="showEditCommentBox('${c.id}', '${escapeHtml(c.content)}')">수정</button> <button class="link-btn" style="color:#d9534f;" onclick="deleteComment('${c.id}', ${reviewId})">삭제</button>` : '';

  const metaHTML = (c) => `
    <div style="display:flex; align-items:center; gap:8px;">
      <img src="${avatarOf(c)}" style="width:24px; height:24px; border-radius:50%; object-fit:cover; background:#eee;" alt="프로필">
      <span><b style="color:#333; font-size:13px;">${authorOf(c)}</b> <span style="color:#888; font-size:11px; margin-left:4px;">${c.created_at ? c.created_at.substring(0, 10) : ''}</span></span>
    </div>
  `;

  listDiv.innerHTML = topComments.map(comment => {
    const repliesHtml = replies.filter(r => r.parent_id === comment.id).map(reply => `
      <div class="reply-box" id="comment-container-${reply.id}">
        <div class="comment-meta" style="margin-bottom:6px;">${metaHTML(reply)}<div>${ownerActions(reply)}</div></div>
        <p style="margin:0 0 4px 0; font-size:13px;" id="comment-text-${reply.id}">↳ ${reply.content}</p>
      </div>
    `).join('');

    return `
      <div class="comment-box" id="comment-container-${comment.id}">
        <div class="comment-meta" style="margin-bottom:6px;">
          ${metaHTML(comment)}
          <div><button class="link-btn" style="color:#007BA7;" onclick="toggleReplyBox('${comment.id}')">답글쓰기</button>${ownerActions(comment)}</div>
        </div>
        <p style="margin:0 0 5px 0; font-size:14px;" id="comment-text-${comment.id}">${comment.content}</p>
        <div id="reply-box-${comment.id}" style="display:none; margin-top:8px;">
          <textarea id="reply-input-${comment.id}" rows="2" placeholder="답글을 남겨보세요" style="font-size:13px; margin-bottom:5px;"></textarea>
          <button class="btn btn-sm" onclick="writeReply(${reviewId}, '${comment.id}')">답글 등록</button>
        </div>
        ${repliesHtml}
      </div>
    `;
  }).join('');
}

function escapeHtml(str) { return str.replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

function showEditCommentBox(commentId, currentContent) {
  document.getElementById(`comment-text-${commentId}`).innerHTML = `
    <textarea id="edit-comment-input-${commentId}" rows="2" style="font-size:13px; margin-bottom:5px;">${currentContent}</textarea>
    <div class="btn-group">
      <button class="btn btn-sm" onclick="updateComment('${commentId}')">저장</button>
      <button class="btn btn-gray btn-sm" onclick="loadComments(currentReviewId)">취소</button>
    </div>
  `;
}

async function updateComment(commentId) {
  const newContent = document.getElementById(`edit-comment-input-${commentId}`).value.trim();
  if (!newContent) { await showAlert('내용을 입력해주세요!'); return; }
  const { error } = await mapDB.from('pothole_comments').update({ content: newContent }).eq('id', commentId);
  if (error) await showAlert('댓글 수정 실패: ' + error.message); else loadComments(currentReviewId);
}

async function deleteComment(commentId, reviewId) {
  if (!await showConfirm('정말 이 댓글을 삭제하시겠습니까?')) return;
  const { error } = await mapDB.from('pothole_comments').delete().eq('id', commentId);
  if (error) await showAlert('댓글 삭제 실패: ' + error.message); else loadComments(reviewId);
}

function toggleReplyBox(commentId) {
  if (!currentUser) { showAlert('로그인이 필요합니다!', () => { go('mypage'); }); return; }
  const box = document.getElementById(`reply-box-${commentId}`);
  box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function writeComment() {
  if (!currentUser) { await showAlert('로그인이 필요합니다!', () => { go('mypage'); }); return; }
  const content = document.getElementById('comment-content').value;
  if (!content) { await showAlert('댓글 내용을 입력해주세요!'); return; }
  
  const authorName = getUserName(currentUser);
  const authorAvatarUrl = getUserAvatar(currentUser);

  const { error } = await mapDB.from('pothole_comments').insert([{
    review_id: currentReviewId, content, parent_id: null, user_id: currentUser.id, author_name: authorName, author_avatar_url: authorAvatarUrl
  }]);
  if (error) await showAlert('댓글 등록 실패: ' + error.message); 
  else { document.getElementById('comment-content').value = ''; loadComments(currentReviewId); }
}

async function writeReply(reviewId, parentId) {
  if (!currentUser) { await showAlert('로그인이 필요합니다!', () => { go('mypage'); }); return; }
  const content = document.getElementById(`reply-input-${parentId}`).value;
  if (!content) { await showAlert('답글 내용을 입력해주세요!'); return; }
  
  const authorName = getUserName(currentUser);
  const authorAvatarUrl = getUserAvatar(currentUser);

  const { error } = await mapDB.from('pothole_comments').insert([{
    review_id: reviewId, content, parent_id: parentId, user_id: currentUser.id, author_name: authorName, author_avatar_url: authorAvatarUrl
  }]);
  if (error) await showAlert('답글 등록 실패: ' + error.message); else loadComments(reviewId);
}

// =====================================================================
// 7. 긴급신고
// =====================================================================
function startReport() {
  const resultDiv = document.getElementById('result');
  resultDiv.style.display = 'block'; resultDiv.innerHTML = '🛰️ 스마트폰 GPS 위치를 가져오는 중...';
  navigator.geolocation.getCurrentPosition(
    (position) => { resultDiv.innerHTML = '🔍 위치 확인 완료! 주소를 가져오는 중...'; processLocation(position.coords.latitude, position.coords.longitude); },
    () => { resultDiv.innerHTML = '❌ 위치를 가져오지 못했습니다. 권한을 확인해주세요.'; },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function processLocation(lat, lng) {
  if (typeof kakao === 'undefined' || !kakao.maps || !kakao.maps.services) { renderNotFound('카카오 API 로드 실패 (도메인 미등록 또는 키 오류)'); return; }
  const geocoder = new kakao.maps.services.Geocoder();
  let isDone = false;
  const timeoutId = setTimeout(() => { if (!isDone) { isDone = true; renderNotFound('카카오 서버 응답 시간 초과 (3초)'); } }, 3000);
  geocoder.coord2Address(lng, lat, function (result, status) {
    if (isDone) return; isDone = true; clearTimeout(timeoutId);
    if (status !== kakao.maps.services.Status.OK || !result || result.length === 0) { renderNotFound('카카오가 해당 좌표의 주소를 찾지 못함'); return; }
    const item = result[0];
    if (!item.road_address || !item.road_address.address_name) { renderNotFound('도로명 주소가 없는 위치입니다 (도로 위가 아님)', item.address ? item.address.address_name : ''); return; }
    renderReportResult(item.road_address.address_name);
  });
}

function renderNotFound(reason, jibun = '') {
  document.getElementById('result').innerHTML = `
    <strong style="color:#d32f2f; font-size:15px;">❌ 주소를 찾을 수 없습니다</strong><br>
    <span style="font-size:12px; color:#666;">${reason}</span><br><br>
    ${jibun ? `<span style="font-size:12px; color:#444;">참고 지번: ${jibun}</span><br>` : ''}
    <span style="font-size:12px; color:#666;">도로 위에서 다시 시도해 주세요.</span>`;
}

function renderReportResult(address) {
  let type = '시·구도 (일반도로)'; let agency = '관할 시·군·구청 도로과'; let phone = '지역번호 + 120'; let badgeColor = '#2ed573';
  if (address.includes('고속도로') || address.includes('IC') || address.includes('JC')) { type = '고속도로'; agency = '한국도로공사'; phone = '1588-2504'; badgeColor = '#ff4757'; } 
  else if (address.includes('국도')) { type = '일반국도'; agency = '국토교통부 국도유지사무소'; phone = '1599-0001'; badgeColor = '#1e90ff'; } 
  else if (address.includes('지방도')) { type = '지방도'; agency = '도청 건설도로과'; phone = '도청 민원실 문의'; badgeColor = '#ffa502'; }
  const phoneHtml = /^[\d-]+$/.test(phone) ? `<a href="tel:${phone}" style="color:#d32f2f; font-size:16px; font-weight:bold;">${phone}</a>` : `<span style="color:#d32f2f; font-size:16px;">${phone}</span>`;
  document.getElementById('result').innerHTML = `
    <strong style="color:#007BA7; font-size:14px;">📍 현재 위치 정보</strong><br>
    <span style="font-size:12px; color:#444; word-break:break-all;">${address}</span><br><br>
    <span style="background-color:${badgeColor}; color:white; padding:3px 8px; border-radius:4px; font-size:11px; font-weight:bold;">${type}</span><br><br>
    <strong>관할 기관:</strong> ${agency}<br><strong>연락처:</strong> ${phoneHtml}`;
}

// =====================================================================
// 8. 마이페이지 
// =====================================================================
function renderMyPage() {
  const img = document.getElementById('profile-image'); const name = document.getElementById('profile-name'); const email = document.getElementById('profile-email');
  const loginSection = document.getElementById('login-section'); const settingsSection = document.getElementById('settings-section');
  if (!img || !name) return;

  if (currentUser) {
    img.src = getUserAvatar(currentUser); name.innerText = getUserName(currentUser); email.innerText = currentUser.email || '';
    document.getElementById('nickname-input').value = getUserName(currentUser);
    loginSection.style.display = 'none'; settingsSection.style.display = 'block';
  } else {
    img.src = PLACEHOLDER_LOGIN; name.innerText = '로그인이 필요합니다'; email.innerText = '';
    loginSection.style.display = 'block'; settingsSection.style.display = 'none';
  }
}

async function updateNickname() {
  if (!currentUser) return;
  const newNickname = document.getElementById('nickname-input').value.trim();
  if (!newNickname) { await showAlert('새로운 닉네임을 입력해주세요!'); return; }
  const { error } = await supabaseClient.auth.updateUser({ data: { name: newNickname, full_name: newNickname } });
  if (error) { await showAlert('닉네임 변경 실패: ' + error.message); return; }

  await mapDB.from('pothole_reviews').update({ author_name: newNickname }).eq('user_id', currentUser.id);
  await mapDB.from('pothole_comments').update({ author_name: newNickname }).eq('user_id', currentUser.id);

  await showAlert('✅ 닉네임이 성공적으로 변경되었습니다!'); checkUser();
}

async function uploadProfileImage(input) {
  if (!currentUser) { await showAlert('로그인 후 이용 가능합니다!', () => { go('mypage'); }); return; }
  if (!input.files || !input.files[0]) return;

  const file = input.files[0];
  const fileName = `profile_${currentUser.id}_${Date.now()}.${file.name.split('.').pop()}`;

  const { error: uploadError } = await supabaseClient.storage.from('profile').upload(fileName, file);
  if (uploadError) { await showAlert('이미지 업로드 실패: ' + uploadError.message); return; }

  const avatarUrl = supabaseClient.storage.from('profile').getPublicUrl(fileName).data.publicUrl;
  const { error: updateError } = await supabaseClient.auth.updateUser({ data: { avatar_url: avatarUrl } });

  if (updateError) { 
    await showAlert('프로필 사진 적용 실패: ' + updateError.message); 
  } else {
    await mapDB.from('pothole_reviews').update({ author_avatar_url: avatarUrl }).eq('user_id', currentUser.id);
    await mapDB.from('pothole_comments').update({ author_avatar_url: avatarUrl }).eq('user_id', currentUser.id);
    await showAlert('✅ 프로필 사진이 변경되었습니다!'); checkUser();
  }
}

// =====================================================================
// 9. 시작
// =====================================================================
(async function init() {
  await checkUser();
  const urlParams = new URLSearchParams(window.location.search);
  const sharedReviewId = urlParams.get('review');
  
  if (sharedReviewId) {
    await loadReviews();
    const targetId = parseInt(sharedReviewId, 10);
    if (allReviews.some(r => r.id === targetId)) showDetailView(targetId);
    else go('board');
    window.history.replaceState({}, document.title, window.location.pathname);
  } else {
    const saved = popReturnView();
    if (saved && saved.view === 'detail' && saved.reviewId) {
      await loadReviews();
      if (allReviews.some(r => r.id === saved.reviewId)) showDetailView(saved.reviewId);
      else go('board');
    } else if (saved && ['map', 'board', 'report', 'mypage'].includes(saved.view)) {
      go(saved.view);
    } else if (saved && saved.view === 'write') {
      go(currentUser ? 'write' : 'board');
    } else { 
      go('map'); 
    }
  }

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    currentUser = session ? session.user : null; renderAuthBar(); renderMyPage();
  });
})();