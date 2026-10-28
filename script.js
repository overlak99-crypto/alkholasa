import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, getDocs, deleteDoc, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDZAkAzFsmwPYgTBefkr6Cdz5ZZBrEHwWo",
  authDomain: "alkholasa-60003.firebaseapp.com",
  projectId: "alkholasa-60003",
  storageBucket: "alkholasa-60003.firebasestorage.app",
  messagingSenderId: "809389270420",
  appId: "1:809389270420:web:cf94dbed51d932b50edb81",
  measurementId: "G-RHPV6M0L20"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let currentUser = null;
let currentTrack = 'انتظام';
let currentSubjectId = null;
let currentLectureId = null;
let activeQuiz = null;
let studentName = '';
let builderQuestions = [];
let currentMediaData = null;

let subjects = [];
let lectures = [];
let quizzes = [];

window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('kholasa_currentUser');
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
        } catch(e) {
            currentUser = null;
        }
    }
    
    updateUIForAuth();
    showPage('home');

    loadDataFromCloud().then(() => {
        updateStats();
        if (document.getElementById('antizam') && document.getElementById('antizam').classList.contains('active')) renderSubjects('انتظام');
        if (document.getElementById('antisab') && document.getElementById('antisab').classList.contains('active')) renderSubjects('انتساب');
        if (document.getElementById('quizzes') && document.getElementById('quizzes').classList.contains('active')) renderQuizzes();
    });
});

async function loadDataFromCloud() {
    try {
        const subSnap = await getDocs(collection(db, "subjects"));
        subjects = [];
        subSnap.forEach(doc => { subjects.push({ id: doc.id, ...doc.data() }); });

        const lecSnap = await getDocs(collection(db, "lectures"));
        lectures = [];
        lecSnap.forEach(doc => { lectures.push({ id: doc.id, ...doc.data() }); });

        const quizSnap = await getDocs(collection(db, "quizzes"));
        quizzes = [];
        quizSnap.forEach(doc => { quizzes.push({ id: doc.id, ...doc.data() }); });
    } catch (e) {
        console.error("Cloud sync error:", e);
    }
}

window.addEventListener('scroll', () => {
    const btn = document.getElementById('back-to-top');
    if (btn) btn.style.display = window.scrollY > 300 ? 'flex' : 'none';
});

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateStats() {
    const subCountEl = document.getElementById('stat-subjects-count');
    const lecCountEl = document.getElementById('stat-lectures-count');
    if (subCountEl) subCountEl.innerText = subjects.length;
    if (lecCountEl) lecCountEl.innerText = lectures.length;
}

function showPage(pageId) {
    if (!currentUser) {
        openAuthModal();
        return;
    }
    
    document.querySelectorAll('.page').forEach(p => {
        p.style.display = 'none';
        p.classList.remove('active');
    });
    
    const page = document.getElementById(pageId);
    if (page) {
        page.style.display = 'block';
        page.classList.add('active');
    }
    
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    if (pageId === 'antizam') {
        renderSubjects('انتظام');
    } else if (pageId === 'antisab') {
        renderSubjects('انتساب');
    } else if (pageId === 'quizzes') {
        renderQuizzes();
    } else if (pageId === 'home') {
        updateStats();
    }
}

function toggleTheme() {
    const html = document.documentElement;
    const themeIcon = document.getElementById('theme-icon');
    if (html.getAttribute('data-theme') === 'dark') {
        html.setAttribute('data-theme', 'light');
        if (themeIcon) themeIcon.className = 'fa-solid fa-sun';
    } else {
        html.setAttribute('data-theme', 'dark');
        if (themeIcon) themeIcon.className = 'fa-solid fa-moon';
    }
}

function handleAuth() {
    const emailInput = document.getElementById('auth-email');
    const passInput = document.getElementById('auth-pass');
    
    if (!emailInput) return;
    const email = emailInput.value.trim();
    const pass = passInput ? passInput.value.trim() : '';

    if (!email) return;

    if (email.toLowerCase() === 'admin@alkholasa.com' && pass === 'Kholasa@2026') {
        currentUser = { email, isAdmin: true };
    } else {
        currentUser = { email, isAdmin: false };
    }

    localStorage.setItem('kholasa_currentUser', JSON.stringify(currentUser));
    updateUIForAuth();
    closeModal('auth-modal');
    showPage('home');
}

function updateUIForAuth() {
    const authBtnText = document.getElementById('auth-btn-text');
    const authBtn = document.getElementById('auth-btn');
    const userDisplay = document.getElementById('user-display');
    const adminControls = document.querySelectorAll('.admin-only');
    const adminNoticeControl = document.getElementById('admin-notice-control');

    if (currentUser) {
        if (authBtnText) authBtnText.innerText = 'خروج';
        if (authBtn) authBtn.onclick = logout;
        if (userDisplay) {
            userDisplay.innerText = currentUser.isAdmin ? '👑 أدمن' : '🎓 ' + currentUser.email.split('@')[0];
            userDisplay.style.display = 'inline';
        }
        adminControls.forEach(el => el.style.display = currentUser.isAdmin ? 'flex' : 'none');
        if (adminNoticeControl) adminNoticeControl.style.display = currentUser.isAdmin ? 'block' : 'none';
    } else {
        if (authBtnText) authBtnText.innerText = 'تسجيل الدخول';
        if (authBtn) authBtn.onclick = openAuthModal;
        if (userDisplay) userDisplay.style.display = 'none';
        adminControls.forEach(el => el.style.display = 'none');
        if (adminNoticeControl) adminNoticeControl.style.display = 'none';
    }
}

function logout() {
    currentUser = null;
    localStorage.removeItem('kholasa_currentUser');
    updateUIForAuth();
    openAuthModal();
}

function timeAgo(timestamp) {
    const ts = Number(timestamp);
    if (isNaN(ts)) return 'منذ فترة';
    const seconds = Math.floor((new Date() - ts) / 1000);
    if (seconds < 60) return 'منذ ثوانٍ قليلة';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return 'منذ ' + minutes + ' دقيقة';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return 'منذ ' + hours + ' ساعة';
    const days = Math.floor(hours / 24);
    return 'منذ ' + days + ' يوم';
}

// زرار "تحديث الموقع الآن"
async function triggerUpdateProcess() {
    const banner = document.getElementById('update-progress-banner');
    const fill = document.getElementById('progress-bar-fill');
    if (banner) banner.style.display = 'block';
    if (fill) fill.style.width = '30%';
    await loadDataFromCloud();
    if (fill) fill.style.width = '100%';
    updateStats();
    setTimeout(function() {
        if (banner) banner.style.display = 'none';
        if (fill) fill.style.width = '0%';
    }, 800);
}

function renderSubjects(track) {
    currentTrack = track;
    const grid = document.getElementById(track === 'انتظام' ? 'antizam-grid' : 'antisab-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const trackSubjects = subjects.filter(s => s.track === track);

    if (trackSubjects.length === 0) {
        grid.innerHTML = '<p style="color:var(--text-muted); grid-column:1/-1; text-align:center; padding:2rem;">لا يوجد مواد مضافة بعد لحساب ' + track + '.</p>';
        return;
    }

    trackSubjects.forEach(sub => {
        const card = document.createElement('div');
        card.className = 'subject-card';
        let deleteBtn = '';
        if (currentUser && currentUser.isAdmin) {
            deleteBtn = '<button class="delete-btn" onclick="deleteSubject(event, \'' + sub.id + '\')"><i class="fa-solid fa-trash"></i></button>';
        }
        card.innerHTML = deleteBtn +
            '<div class="subject-icon-box"><i class="fa-solid fa-book-bookmark"></i></div>' +
            '<h3>' + sub.name + '</h3>' +
            '<span class="time-ago">تمت الإضافة ' + timeAgo(sub.createdAt || sub.id) + '</span>' +
            '<span style="color:var(--primary-gold); font-size:0.85rem; margin-top:0.4rem; font-weight:bold;">تصفح المحتوى ←</span>';
        card.onclick = function() { openSubjectDetail(sub); };
        grid.appendChild(card);
    });
}

function openAddSubjectModal(track) {
    currentTrack = track;
    const input = document.getElementById('new-subject-name');
    if (input) input.value = '';
    const modal = document.getElementById('subject-modal');
    if (modal) modal.style.display = 'flex';
}

async function saveSubject() {
    const nameInput = document.getElementById('new-subject-name');
    if (!nameInput) return;
    const name = nameInput.value.trim();
    if (!name) return;

    const subId = String(Date.now());
    const newSub = { track: currentTrack, name: name, createdAt: Date.now() };

    try {
        await setDoc(doc(db, "subjects", subId), newSub);
        closeModal('subject-modal');
        await loadDataFromCloud();
        renderSubjects(currentTrack);
    } catch (e) {
        console.error("Error saving subject", e);
        alert('حدث خطأ أثناء حفظ المادة: ' + e.message);
    }
}

async function deleteSubject(e, id) {
    e.stopPropagation();
    try {
        await deleteDoc(doc(db, "subjects", String(id)));
        await loadDataFromCloud();
        renderSubjects(currentTrack);
    } catch (e) {
        console.error("Error deleting subject", e);
    }
}

function openSubjectDetail(sub) {
    currentSubjectId = sub.id;
    const titleEl = document.getElementById('current-subject-title');
    const nameBar = document.getElementById('current-subject-name-bar');
    if (titleEl) titleEl.innerText = sub.name;
    if (nameBar) nameBar.innerText = sub.name;
    
    showPage('subject-detail');
    renderLectures();
}

function goBackToTrack() {
    showPage(currentTrack === 'انتظام' ? 'antizam' : 'antisab');
}

function openAddLectureModal() {
    document.getElementById('new-lecture-title').value = '';
    document.getElementById('lecture-images').value = '';
    document.getElementById('lecture-videos').value = '';
    document.getElementById('lecture-files').value = '';
    document.getElementById('lecture-modal').style.display = 'flex';
}

// ===== إعدادات Cloudinary =====
const CLOUD_NAME = 'flilvppv';
const UPLOAD_PRESET = 'kholasa';

async function uploadToCloudinary(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', UPLOAD_PRESET);
    const res = await fetch('https://api.cloudinary.com/v1_1/' + CLOUD_NAME + '/auto/upload', {
        method: 'POST',
        body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ? data.error.message : 'فشل الرفع');
    return data.secure_url;
}

async function uploadFiles(files, folder, lectureId) {
    const result = [];
    for (let i = 0; i < files.length; i++) {
        const url = await uploadToCloudinary(files[i]);
        result.push({ name: files[i].name, data: url });
    }
    return result;
}

let isSavingLecture = false;

async function saveLectureData() {
    if (isSavingLecture) return;

    const title = document.getElementById('new-lecture-title').value.trim();
    if (!title) {
        alert('من فضلك اكتب عنوان المحاضرة');
        return;
    }

    const btn = document.getElementById('saveLectureBtn');
    isSavingLecture = true;
    if (btn) {
        btn.disabled = true;
        btn.innerText = 'جاري الرفع... لا تغلق الصفحة';
    }

    const lectureId = String(Date.now());

    try {
        const images = await uploadFiles(document.getElementById('lecture-images').files, 'images', lectureId);
        const videos = await uploadFiles(document.getElementById('lecture-videos').files, 'videos', lectureId);
        const files = await uploadFiles(document.getElementById('lecture-files').files, 'files', lectureId);

        await setDoc(doc(db, "lectures", lectureId), {
            subjectId: String(currentSubjectId),
            title: title,
            images: images,
            videos: videos,
            files: files,
            createdAt: Date.now()
        });

        closeModal('lecture-modal');
        await loadDataFromCloud();
        renderLectures();
        updateStats();
    } catch (e) {
        console.error("Error saving lecture", e);
        alert('حدث خطأ أثناء الحفظ: ' + e.message);
    } finally {
        isSavingLecture = false;
        if (btn) {
            btn.disabled = false;
            btn.innerText = 'حفظ ونشر المحاضرة';
        }
    }
}

function renderLectures() {
    const list = document.getElementById('lectures-list');
    if (!list) return;
    list.innerHTML = '';

    const subLectures = lectures.filter(l => String(l.subjectId) === String(currentSubjectId));

    if (subLectures.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted); grid-column:1/-1; text-align:center; padding:2rem;">لا توجد محاضرات مضافة لهذه المادة بعد.</p>';
        return;
    }

    subLectures.forEach(lec => {
        const card = document.createElement('div');
        card.className = 'subject-card';
        let deleteBtn = '';
        if (currentUser && currentUser.isAdmin) {
            deleteBtn = '<button class="delete-btn" onclick="deleteLecture(event, \'' + lec.id + '\')"><i class="fa-solid fa-trash"></i></button>';
        }
        card.innerHTML = deleteBtn +
            '<div class="subject-icon-box"><i class="fa-solid fa-file-lines"></i></div>' +
            '<h3>' + lec.title + '</h3>' +
            '<span class="time-ago">تمت الإضافة ' + timeAgo(lec.createdAt || lec.id) + '</span>' +
            '<span style="color:var(--primary-gold); font-size:0.85rem; margin-top:0.4rem; font-weight:bold;">فتح المحاضرة ←</span>';
        card.onclick = function() { openLectureDetail(lec); };
        list.appendChild(card);
    });
}

async function deleteLecture(e, id) {
    e.stopPropagation();
    try {
        await deleteDoc(doc(db, "lectures", String(id)));
        await loadDataFromCloud();
        renderLectures();
        updateStats();
    } catch (e) {
        console.error("Error deleting lecture", e);
    }
}

function openLectureDetail(lec) {
    currentLectureId = lec.id;
    document.getElementById('current-lecture-title').innerText = lec.title;
    showPage('lecture-detail');

    const contentList = document.getElementById('lecture-content-list');
    contentList.innerHTML = '';
    currentMediaData = lec;

    let htmlContent = '';

    if (lec.images && lec.images.length > 0) {
        htmlContent += '<h3 style="color:var(--primary-gold); margin-bottom:1rem;"><i class="fa-solid fa-image"></i> الصور المرفقة (' + lec.images.length + ')</h3>';
        htmlContent += '<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap:1rem; margin-bottom:2rem;">';
        for (let i = 0; i < lec.images.length; i++) {
            const img = lec.images[i];
            htmlContent += '<div style="background:var(--card-bg); border:1px solid var(--card-border); border-radius:12px; padding:0.8rem; text-align:center;">';
            htmlContent += '<img src="' + img.data + '" alt="' + img.name + '" style="width:100%; height:140px; border-radius:8px; object-fit:cover; margin-bottom:0.8rem;">';
            htmlContent += '<button onclick="viewMedia(\'image\', ' + i + ', \'images\')" style="background:var(--accent-cyan); color:#000; border:none; padding:0.4rem 0.8rem; border-radius:6px; font-weight:bold; cursor:pointer; font-size:0.8rem; width:100%;"><i class="fa-solid fa-eye"></i> مشاهدة مباشرة</button>';
            htmlContent += '</div>';
        }
        htmlContent += '</div>';
    }

    if (lec.videos && lec.videos.length > 0) {
        htmlContent += '<h3 style="color:var(--primary-gold); margin-bottom:1rem;"><i class="fa-solid fa-video"></i> فيديوهات الشرح (' + lec.videos.length + ')</h3>';
        htmlContent += '<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:1rem; margin-bottom:2rem;">';
        for (let i = 0; i < lec.videos.length; i++) {
            const vid = lec.videos[i];
            htmlContent += '<div style="background:var(--card-bg); border:1px solid var(--card-border); border-radius:12px; padding:0.8rem; text-align:center;">';
            htmlContent += '<p style="font-weight:bold; margin-bottom:0.6rem; font-size:0.9rem;">' + vid.name + '</p>';
            htmlContent += '<button onclick="viewMedia(\'video\', ' + i + ', \'videos\')" style="background:var(--accent-cyan); color:#000; border:none; padding:0.4rem 0.9rem; border-radius:6px; font-weight:bold; cursor:pointer; font-size:0.8rem; width:100%;"><i class="fa-solid fa-play"></i> مشاهدة مباشرة</button>';
            htmlContent += '</div>';
        }
        htmlContent += '</div>';
    }

    if (lec.files && lec.files.length > 0) {
        htmlContent += '<h3 style="color:var(--primary-gold); margin-bottom:1rem;"><i class="fa-solid fa-file"></i> الملفات والـ PDF (' + lec.files.length + ')</h3>';
        htmlContent += '<div style="display:flex; flex-direction:column; gap:0.8rem; margin-bottom:2rem;">';
        for (let i = 0; i < lec.files.length; i++) {
            const file = lec.files[i];
            htmlContent += '<div style="background:var(--card-bg); border:1px solid var(--card-border); border-radius:12px; padding:1rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">';
            htmlContent += '<span style="font-weight:bold;">' + file.name + '</span>';
            htmlContent += '<button onclick="viewMedia(\'pdf\', ' + i + ', \'files\')" style="background:var(--accent-cyan); color:#000; border:none; padding:0.4rem 0.9rem; border-radius:6px; font-weight:bold; cursor:pointer; font-size:0.8rem;"><i class="fa-solid fa-eye"></i> معاينة بالموقع</button>';
            htmlContent += '</div>';
        }
        htmlContent += '</div>';
    }

    if (!htmlContent) {
        htmlContent = '<p style="color:var(--text-muted); text-align:center; padding:2rem;">لا توجد محتويات مرفقة في هذه المحاضرة.</p>';
    }

    contentList.innerHTML = htmlContent;
}

function viewMedia(type, index, mediaType) {
    if (!currentMediaData || !currentMediaData[mediaType] || !currentMediaData[mediaType][index]) return;

    const item = currentMediaData[mediaType][index];
    const modal = document.getElementById('media-view-modal');
    const title = document.getElementById('media-modal-title');
    const body = document.getElementById('media-modal-body');

    title.innerText = item.name;
    body.innerHTML = '';

    if (type === 'image') {
        body.innerHTML = '<img src="' + item.data + '" alt="' + item.name + '" draggable="false" style="width:100%; max-height:70vh; object-fit:contain; border-radius:8px; pointer-events:none;">';
    } else if (type === 'video') {
        body.innerHTML = '<video controls autoplay controlsList="nodownload noremoteplayback" disablePictureInPicture oncontextmenu="return false" src="' + item.data + '" style="width:100%; max-height:70vh; border-radius:8px;"></video>';
    } else if (type === 'pdf') {
        showPdfAsImages(item, body);
    }

    modal.style.display = 'flex';
}

function showPdfAsImages(item, body) {
    const url = item.data;
    const email = currentUser ? currentUser.email : '';

    // لو الملف مش PDF على Cloudinary، نعرضه بشكل عادي
    if (!(url.indexOf('/image/upload/') !== -1 && /\.pdf($|\?)/i.test(url))) {
        body.innerHTML = '<iframe src="' + url + '#toolbar=0&navpanes=0" style="width:100%; height:65vh; border:none; border-radius:8px;"></iframe>';
        return;
    }

    const base = url.replace('/image/upload/', '/image/upload/pg_PAGE/').replace(/\.pdf($|\?.*)/i, '.jpg');

    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.userSelect = 'none';

    const pages = document.createElement('div');
    wrapper.appendChild(pages);

    const safeEmail = email.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200'><text x='20' y='110' fill='rgba(120,120,120,0.28)' font-size='16' font-family='Arial' transform='rotate(-25 160 100)'>" + safeEmail + "</text></svg>";
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute; inset:0; pointer-events:none; background-repeat:repeat; background-image:url("data:image/svg+xml,' + encodeURIComponent(svg) + '");';
    wrapper.appendChild(overlay);

    body.appendChild(wrapper);

    let page = 1;
    function loadNext() {
        if (page > 150) return;
        const img = new Image();
        img.draggable = false;
        img.style.cssText = 'width:100%; display:block; margin-bottom:8px; border-radius:6px; pointer-events:none;';
        img.onload = function() {
            pages.appendChild(img);
            page++;
            loadNext();
        };
        img.onerror = function() {
            if (page === 1) {
                pages.innerHTML = '<p style="padding:1rem;">تعذر عرض الملف</p>';
            }
        };
        img.src = base.replace('PAGE', page);
    }
    loadNext();
}

function goBackToSubject() {
    const sub = subjects.find(s => s.id === currentSubjectId);
    if (sub) openSubjectDetail(sub);
}

function renderQuizzes() {
    const grid = document.getElementById('quizzes-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (quizzes.length === 0) {
        grid.innerHTML = '<p style="color:var(--text-muted); grid-column:1/-1; text-align:center; padding:2rem;">لا يوجد اختبارات مضافة بعد.</p>';
        return;
    }

    quizzes.forEach(quiz => {
        const card = document.createElement('div');
        card.className = 'subject-card';
        let deleteBtn = '';
        if (currentUser && currentUser.isAdmin) {
            deleteBtn = '<button class="delete-btn" onclick="deleteQuiz(event, \'' + quiz.id + '\')"><i class="fa-solid fa-trash"></i></button>';
        }
        card.innerHTML = deleteBtn +
            '<div class="subject-icon-box"><i class="fa-solid fa-pen-to-square"></i></div>' +
            '<h3>' + quiz.title + '</h3>' +
            '<span class="time-ago">تمت الإضافة ' + timeAgo(quiz.createdAt || quiz.id) + '</span>' +
            '<span style="color:var(--primary-gold); font-size:0.85rem; margin-top:0.4rem; font-weight:bold;">دخول للاختبار ←</span>';
        card.onclick = function() { openStudentNameModal(quiz); };
        grid.appendChild(card);
    });
}

function openAddQuizModal() {
    document.getElementById('quiz-title-input').value = '';
    const imgInput = document.getElementById('quiz-image-input');
    if(imgInput) imgInput.value = '';
    document.getElementById('quiz-builder-area').innerHTML = '';
    builderQuestions = [];
    addQuestionField();
    document.getElementById('quiz-modal').style.display = 'flex';
}

function addQuestionField() {
    const area = document.getElementById('quiz-builder-area');
    const qIndex = builderQuestions.length + 1;
    const quizType = document.getElementById('quiz-type-select').value;

    const qBox = document.createElement('div');
    qBox.style.background = 'var(--input-bg)';
    qBox.style.padding = '0.8rem';
    qBox.style.borderRadius = '8px';
    qBox.style.marginBottom = '0.8rem';

    let answersHTML = '';
    if (quizType === 'tf') {
        answersHTML = '<div class="form-group" style="margin-bottom:0.5rem;"><label>الإجابة الصحيحة</label><select class="q-correct"><option value="صح">صح (✅)</option><option value="غلط">غلط (❌)</option></select></div>';
    } else if (quizType === 'mcq') {
        answersHTML = '<div class="form-group" style="margin-bottom:0.5rem;"><label>الإجابة الصحيحة (رقم الخيار)</label><select class="q-correct"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></div>' +
            '<input type="text" class="q-opt1" placeholder="الخيار 1" style="margin-bottom:0.3rem;">' +
            '<input type="text" class="q-opt2" placeholder="الخيار 2" style="margin-bottom:0.3rem;">' +
            '<input type="text" class="q-opt3" placeholder="الخيار 3" style="margin-bottom:0.3rem;">' +
            '<input type="text" class="q-opt4" placeholder="الخيار 4">';
    } else {
        answersHTML = '<div class="form-group" style="margin-bottom:0.5rem;"><label>الإجابة النموذجية (للمراجعة)</label><input type="text" class="q-correct" placeholder="الإجابة النموذجية"></div>';
    }

    qBox.innerHTML = '<div class="form-group" style="margin-bottom:0.5rem;"><label>السؤال ' + qIndex + '</label><input type="text" class="q-text" placeholder="نص السؤال"></div>' + answersHTML;
    area.appendChild(qBox);
    builderQuestions.push(qBox);
}

async function saveQuizData() {
    const title = document.getElementById('quiz-title-input').value.trim();
    const type = document.getElementById('quiz-type-select').value;
    const imgInput = document.getElementById('quiz-image-input');

    if (!title) return;

    let questions = [];
    const boxes = document.querySelectorAll('#quiz-builder-area > div');

    boxes.forEach(function(box, i) {
        const textEl = box.querySelector('.q-text');
        const text = textEl ? textEl.value.trim() : '';
        const correctEl = box.querySelector('.q-correct');
        const correct = correctEl ? correctEl.value : '';
        
        let options = [];
        if (type === 'mcq') {
            const o1 = box.querySelector('.q-opt1');
            const o2 = box.querySelector('.q-opt2');
            const o3 = box.querySelector('.q-opt3');
            const o4 = box.querySelector('.q-opt4');
            if (o1 && o1.value.trim()) options.push(o1.value.trim());
            if (o2 && o2.value.trim()) options.push(o2.value.trim());
            if (o3 && o3.value.trim()) options.push(o3.value.trim());
            if (o4 && o4.value.trim()) options.push(o4.value.trim());
        }

        if (text) {
            questions.push({
                id: i + 1,
                text: text,
                correct: correct,
                options: options
            });
        }
    });

    if (questions.length === 0) return;

    const quizId = String(Date.now());

    try {
        let imageUrl = null;
        if (imgInput && imgInput.files.length > 0) {
            imageUrl = await uploadToCloudinary(imgInput.files[0]);
        }

        const newQuiz = { title: title, type: type, image: imageUrl, questions: questions, createdAt: Date.now() };
        await setDoc(doc(db, "quizzes", quizId), newQuiz);
        closeModal('quiz-modal');
        await loadDataFromCloud();
        renderQuizzes();
    } catch (e) {
        console.error("Error saving quiz", e);
        alert('حدث خطأ أثناء حفظ الاختبار: ' + e.message);
    }
}

async function deleteQuiz(e, id) {
    e.stopPropagation();
    try {
        await deleteDoc(doc(db, "quizzes", String(id)));
        await loadDataFromCloud();
        renderQuizzes();
    } catch (e) {
        console.error("Error deleting quiz", e);
    }
}

function openStudentNameModal(quiz) {
    activeQuiz = quiz;
    document.getElementById('student-full-name').value = '';
    document.getElementById('student-name-modal').style.display = 'flex';
}

function startQuizWithStudentName() {
    const name = document.getElementById('student-full-name').value.trim();
    if (!name) return;
    studentName = name;
    closeModal('student-name-modal');
    renderQuizSolvePage();
}

function renderQuizSolvePage() {
    document.getElementById('quiz-solve-title').innerText = activeQuiz.title;
    showPage('quiz-solve');

    const body = document.getElementById('quiz-questions-body');
    body.innerHTML = '';

    let html = '';

    if (activeQuiz.image) {
        html += '<div style="text-align:center; margin-bottom:1.5rem;"><img src="' + activeQuiz.image + '" style="max-width:100%; border-radius:12px; border:1px solid var(--card-border);"></div>';
    }

    activeQuiz.questions.forEach(function(q, idx) {
        html += '<div class="quiz-item-box" style="background:var(--card-bg); border:1px solid var(--card-border); padding:1.2rem; border-radius:12px; margin-bottom:1rem;"><h4 style="color:var(--primary-gold); margin-bottom:0.8rem;">سـ ' + (idx + 1) + ': ' + q.text + '</h4>';

        if (activeQuiz.type === 'tf') {
            html += '<label class="quiz-option-label" style="display:block; margin-bottom:0.5rem; cursor:pointer;"><input type="radio" name="q_' + q.id + '" value="صح"> (✅) صح</label>';
            html += '<label class="quiz-option-label" style="display:block; margin-bottom:0.5rem; cursor:pointer;"><input type="radio" name="q_' + q.id + '" value="غلط"> (❌) غلط</label>';
        } else if (activeQuiz.type === 'mcq') {
            q.options.forEach(function(opt, optIdx) {
                html += '<label class="quiz-option-label" style="display:block; margin-bottom:0.5rem; cursor:pointer;"><input type="radio" name="q_' + q.id + '" value="' + (optIdx + 1) + '"> ' + (optIdx + 1) + '. ' + opt + '</label>';
            });
        } else {
            html += '<textarea name="q_' + q.id + '" placeholder="اكتب إجابتك هنا..." rows="2" style="width:100%; padding:0.8rem; background:var(--input-bg); border:1px solid var(--card-border); border-radius:8px; color:var(--text-main); outline:none; margin-top:0.5rem;"></textarea>';
        }

        html += '</div>';
    });

    html += '<button class="btn-submit" style="padding:1rem; font-size:1.1rem; margin-top:1rem; width:100%; cursor:pointer;" onclick="submitQuizAnswers()">ارسال الحل والتصحيح التلقائي</button>';
    html += '<div id="quiz-results-area" style="margin-top:1.5rem;"></div>';

    body.innerHTML = html;
}

function submitQuizAnswers() {
    let score = 0;
    const total = activeQuiz.questions.length;
    let reviewHTML = '<div style="background:var(--card-bg); border:1px solid var(--card-border); border-radius:16px; padding:1.5rem; margin-top:1.5rem;">';
    
    reviewHTML += '<h3 style="color:var(--accent-cyan); text-align:center;">نتيجة الطالب: ' + studentName + '</h3>';

    activeQuiz.questions.forEach(function(q) {
        let userAns = '';
        if (activeQuiz.type === 'essay') {
            const txt = document.querySelector('textarea[name="q_' + q.id + '"]');
            userAns = txt ? txt.value.trim() : '';
            if (userAns) score++;
        } else {
            const selected = document.querySelector('input[name="q_' + q.id + '"]:checked');
            userAns = selected ? selected.value : 'لم يتم الحل';
            if (userAns === q.correct) score++;
        }

        const isCorrect = (activeQuiz.type === 'essay') ? true : (userAns === q.correct);

        reviewHTML += '<div style="border-bottom:1px dashed var(--card-border); padding:0.8rem 0; text-align:right;">';
        reviewHTML += '<p style="font-weight:bold;">' + q.text + '</p>';
        reviewHTML += '<p style="font-size:0.85rem; color:' + (isCorrect ? 'var(--primary-gold)' : 'var(--danger)') + ';">';
        reviewHTML += 'إجابتك: ' + (userAns || 'فارغ');
        
        if (activeQuiz.type !== 'essay') {
            reviewHTML += isCorrect ? ' ✔ (إجابة صحيحة)' : ' ✖ (الإجابة الصحيحة هي: ' + q.correct + ')';
        }
        reviewHTML += '</p>';

        if (activeQuiz.type === 'essay') {
            reviewHTML += '<p style="font-size:0.8rem; color:var(--text-muted); margin-top:0.2rem;">الإجابة النموذجية: ' + q.correct + '</p>';
        }
        reviewHTML += '</div>';
    });

    reviewHTML += '<h2 style="text-align:center; color:var(--primary-gold); margin-top:1rem;">الدرجة النهائية: ' + score + ' من ' + total + '</h2></div>';

    document.getElementById('quiz-results-area').innerHTML = reviewHTML;
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function openAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.style.display = 'flex';
}

function openWhatsAppModal() {
    const modal = document.getElementById('whatsapp-modal');
    if (modal) modal.style.display = 'flex';
}

function closeModal(id) { 
    const m = document.getElementById(id);
    if (m) m.style.display = 'none'; 
}

window.showPage = showPage;
window.toggleTheme = toggleTheme;
window.handleAuth = handleAuth;
window.logout = logout;
window.openAuthModal = openAuthModal;
window.openWhatsAppModal = openWhatsAppModal;
window.closeModal = closeModal;
window.scrollToTop = scrollToTop;
window.renderSubjects = renderSubjects;
window.openAddSubjectModal = openAddSubjectModal;
window.saveSubject = saveSubject;
window.deleteSubject = deleteSubject;
window.openSubjectDetail = openSubjectDetail;
window.goBackToTrack = goBackToTrack;
window.openAddLectureModal = openAddLectureModal;
window.saveLectureData = saveLectureData;
window.deleteLecture = deleteLecture;
window.openLectureDetail = openLectureDetail;
window.viewMedia = viewMedia;
window.goBackToSubject = goBackToSubject;
window.renderQuizzes = renderQuizzes;
window.openAddQuizModal = openAddQuizModal;
window.addQuestionField = addQuestionField;
window.saveQuizData = saveQuizData;
window.deleteQuiz = deleteQuiz;
window.openStudentNameModal = openStudentNameModal;
window.startQuizWithStudentName = startQuizWithStudentName;
window.submitQuizAnswers = submitQuizAnswers;
window.triggerUpdateProcess = triggerUpdateProcess;

// ربط زرار حفظ المحاضرة (مرة واحدة فقط)
const saveLectureBtnEl = document.getElementById('saveLectureBtn');
if (saveLectureBtnEl) {
    saveLectureBtnEl.addEventListener('click', saveLectureData);
}