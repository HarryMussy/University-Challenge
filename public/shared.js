// ── Shared config across all pages ──────────────────
const EMAILJS_CONFIG = {
  publicKey:  '7Umbf9uCGy2Ssvs4O',
  serviceId:  'service_f64lhzl',
  templateId: 'template_n8yatli',
};

const ALLOWED_DOMAINS = [
  'microsoft.com', 'outlook.com', 'hotmail.com',
  'gmail.com', 'meadowhead.sheffield.sch.uk'
];

const TEAM_COLOURS = [
  '#FF6B6B','#4A90D9','#6BCF7F','#FFD93D',
  '#A78BFA','#FB923C','#38BDF8','#F472B6',
];

// Session helpers
const Session = {
  saveTeacher(email) {
    localStorage.setItem('uc_teacher', JSON.stringify({
      email, expiry: Date.now() + 7 * 24 * 60 * 60 * 1000
    }));
  },
  getTeacher() {
    try {
      const s = JSON.parse(localStorage.getItem('uc_teacher'));
      return s && s.expiry > Date.now() ? s : null;
    } catch { return null; }
  },
  clearTeacher() { localStorage.removeItem('uc_teacher'); },

  saveStudent(data) { sessionStorage.setItem('uc_student', JSON.stringify(data)); },
  getStudent()      { try { return JSON.parse(sessionStorage.getItem('uc_student')); } catch { return null; } },
  clearStudent()    { sessionStorage.removeItem('uc_student'); },

  saveRoom(data)    { sessionStorage.setItem('uc_room', JSON.stringify(data)); },
  getRoom()         { try { return JSON.parse(sessionStorage.getItem('uc_room')); } catch { return null; } },
  clearRoom()       { sessionStorage.removeItem('uc_room'); },

  saveGame(data)    { sessionStorage.setItem('uc_game', JSON.stringify(data)); },
  getGame()         { try { return JSON.parse(sessionStorage.getItem('uc_game')); } catch { return null; } },
  clearGame()       { sessionStorage.removeItem('uc_game'); },
};

// DOM helpers
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

function setStatus(id, msg, type) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `status-msg status-${type}`;
  el.classList.remove('hidden');
}
function clearStatus(id) {
  const el = $(id);
  if (el) { el.textContent = ''; el.classList.add('hidden'); }
}

// Make OTP code
function makeOtp() { return Math.floor(100000 + Math.random() * 900000).toString(); }

// Room code generator
function makeRoomCode() {
  return Array.from({ length: 6 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)]).join('');
}
