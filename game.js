/* ════════════════════════════════════════════════
   UNIVERSITY CHALLENGE — game.js
   Features:
   - EmailJS OTP authentication for teachers
   - Real in-browser lobby with BroadcastChannel
   - Teams mode (2–8 named teams) + Solo/Individuals mode
   - Excel upload (read questions) + template download
   - Full game flow with buzzer, scoring, results
════════════════════════════════════════════════ */

// ── EmailJS Config ────────────────────────────
const EMAILJS_CONFIG = {
	publicKey:   '7Umbf9uCGy2Ssvs4O',
	serviceId:   'service_f64lhzl',      // EmailJS > Email Services
	templateId:  'template_n8yatli',     // EmailJS > Email Templates
};

// Allowed staff email domains - add your school/org domains here
const ALLOWED_DOMAINS = [
	'microsoft.com',
	'outlook.com',
	'hotmail.com',
	'gmail.com',
	'meadowhead.sheffield.sch.uk'
];

// Team colours (used for team badges)
const TEAM_COLOURS = [
  '#FF6B6B','#4A90D9','#6BCF7F','#FFD93D',
  '#A78BFA','#FB923C','#38BDF8','#F472B6',
];

// ── BroadcastChannel (local multi-tab lobby) ──
// Replaces a WebSocket for local/LAN use.
// For a real deployment, swap this for WebSocket/Supabase/Firebase.
const CHANNEL_NAME = 'uc_lobby';

class UniversityChallenge {
  constructor() {
    // Auth
    this.pendingEmail  = null;
    this.generatedOtp  = null;
    this.otpExpiry     = null;
    this.otpAttempts   = 0;
    this.MAX_ATTEMPTS  = 3;
    this.OTP_VALID_MS  = 10 * 60 * 1000;
    this.loggedInEmail = null; // Store logged in teacher email
    this.sessionToken  = null; // Simple session token

    // Game config
    this.gameMode      = 'teams'; // 'teams' | 'solo'
    this.teamCount     = 2;
    this.teams         = [];      // [{ id, name, colour }]
    this.questions     = [];
    this.currentQIdx   = 0;
    this.scores        = {};      // { entityId: points }
    this.players       = {};      // { name: { team?, id } } — populated via lobby
    this.gameActive    = false;
    this.buzzedBy      = null;    // name of who buzzed
    this.currentRoom   = null;
    this.isHost        = false;
    this.questionRevealed = false;  // Track if question is fully revealed
    this.answerRevealed = false;    // Track if answer is revealed

    // Comms
    this.channel       = null;
    this.myName        = null;    // student's own name
    this.myTeamId      = null;

    this._timerInterval = null;

    this.initEmailJS();
    this.buildTeamNameInputs();
    this.initListeners();
    this.checkStoredSession(); // Check for existing login session
  }

  // ════════════════════════════════════════════
  // SESSION MANAGEMENT
  // ════════════════════════════════════════════
  checkStoredSession() {
    try {
      const session = JSON.parse(localStorage.getItem('uc_teacher_session'));
      if (session && session.email && session.token && session.expiry > Date.now()) {
        this.loggedInEmail = session.email;
        this.sessionToken = session.token;
        this.isHost = true;
        $('teacherDisplayEmail').textContent = session.email;
        this.showScreen('teacherDashboard');
      }
    } catch (e) {
      // Invalid session data, clear it
      localStorage.removeItem('uc_teacher_session');
    }
  }

  createSession(email) {
    this.loggedInEmail = email;
    this.sessionToken = Math.random().toString(36).substring(2, 15);
    const session = {
      email: email,
      token: this.sessionToken,
      expiry: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
    };
    localStorage.setItem('uc_teacher_session', JSON.stringify(session));
  }

  clearSession() {
    this.loggedInEmail = null;
    this.sessionToken = null;
    localStorage.removeItem('uc_teacher_session');
  }

  // ════════════════════════════════════════════
  // EMAILJS
  // ════════════════════════════════════════════
  initEmailJS() {
    if (typeof emailjs !== 'undefined' && EMAILJS_CONFIG.publicKey !== 'YOUR_PUBLIC_KEY') {
      emailjs.init(EMAILJS_CONFIG.publicKey);
    }
  }

  // ════════════════════════════════════════════
  // EVENT LISTENERS
  // ════════════════════════════════════════════
  initListeners() {
    // Landing
    $('teacherLoginBtn').onclick  = () => this.showScreen('teacherLoginScreen');
    $('studentJoinBtn').onclick   = () => this.showScreen('studentJoinScreen');

    // Teacher login
    $('teacherEmailSubmit').onclick = () => this.sendOtp();
    $('backToMainBtn').onclick      = () => this.showScreen('loginScreen');
    $('teacherEmail').onkeydown     = e => { if (e.key === 'Enter') this.sendOtp(); };
    $('verifyOtpBtn').onclick       = () => this.verifyOtp();
    $('resendOtpBtn').onclick       = () => this.resendOtp();
    $('changeEmailBtn').onclick     = () => this.showEmailStep();

    // OTP digit wiring
    const digits = $$('.otp-digit');
    digits.forEach((inp, i) => {
      inp.oninput = e => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(-1);
        if (e.target.value && i < digits.length - 1) digits[i + 1].focus();
        this.refreshVerifyBtn();
      };
      inp.onkeydown = e => {
        if (e.key === 'Backspace' && !e.target.value && i > 0) digits[i - 1].focus();
        if (e.key === 'Enter') this.verifyOtp();
      };
      inp.onpaste = e => {
        e.preventDefault();
        const txt = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
        digits.forEach((d, j) => d.value = txt[j] || '');
        digits[Math.min(txt.length, digits.length) - 1].focus();
        this.refreshVerifyBtn();
      };
    });

    // Dashboard
    $('logoutBtn').onclick       = () => this.logout();
    $('teamModeBtn').onclick     = () => this.setMode('teams');
    $('soloModeBtn').onclick     = () => this.setMode('solo');
    $('teamCountMinus').onclick  = () => this.adjustTeamCount(-1);
    $('teamCountPlus').onclick   = () => this.adjustTeamCount(1);
    $('downloadTemplateBtn').onclick = () => this.downloadExcelTemplate();
    $('uploadExcel').onchange    = e => this.handleExcelUpload(e);
    $('createRoomBtn').onclick   = () => this.createRoom();
    $('copyCodeBtn').onclick     = () => this.copyRoomCode();
    $('startGameBtn').onclick    = () => this.startGame();

    // Student join
    $('joinRoomBtn').onclick    = () => this.studentJoin();
    $('backToMainBtn3').onclick = () => this.showScreen('loginScreen');
    $('roomCodeInput').oninput  = e => { e.target.value = e.target.value.toUpperCase(); };

    // Game — host
    $('revealAnswerBtn').onclick = () => this.revealAnswer();
    $('revealQuestionBtn').onclick = () => this.revealQuestion();
    $('correctBtn').onclick      = () => this.markAnswer(true);
    $('incorrectBtn').onclick    = () => this.markAnswer(false);
    $('nextQuestionBtn').onclick = () => this.nextQuestion();

    // Game — student
    $('buzzButton').onclick = () => this.buzzIn();

    // Results
    $('playAgainBtn').onclick = () => this.resetGame();

    // Download template
    $('downloadTemplateBtn').onclick = () => this.downloadExcelTemplate();
  }

  // ════════════════════════════════════════════
  // SCREEN NAV
  // ════════════════════════════════════════════
  showScreen(id) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    $(id).classList.add('active');
  }

  // ════════════════════════════════════════════
  // OTP AUTH
  // ════════════════════════════════════════════
  emailAllowed(email) {
    const domain = email.split('@')[1]?.toLowerCase();
    return ALLOWED_DOMAINS.some(d => domain === d);
  }

  showEmailStep() {
    $('emailStep').classList.remove('hidden');
    $('otpStep').classList.add('hidden');
    this.clearStatus('loginStatus');
  }

  showOtpStep() {
    $('emailStep').classList.add('hidden');
    $('otpStep').classList.remove('hidden');
    $('otpEmailDisplay').textContent = this.pendingEmail;
    $$('.otp-digit').forEach(d => d.value = '');
    $$('.otp-digit')[0].focus();
    this.refreshVerifyBtn();
    this.startOtpTimer();
  }

  async sendOtp() {
    const email = $('teacherEmail').value.trim().toLowerCase();
    if (!email.includes('@')) { this.setStatus('loginStatus', 'Enter a valid email address.', 'error'); return; }
    if (!this.emailAllowed(email)) { this.setStatus('loginStatus', 'Only authorised staff email addresses are permitted.', 'error'); return; }

    this.pendingEmail  = email;
    this.generatedOtp  = this.makeOtp();
    this.otpExpiry     = Date.now() + this.OTP_VALID_MS;
    this.otpAttempts   = 0;

    const btn = $('teacherEmailSubmit');
    btn.disabled = true; btn.textContent = 'Sending…';
    this.clearStatus('loginStatus');

    try {
      await this.dispatchEmail(email, this.generatedOtp);
      this.showOtpStep();
    } catch (e) {
      console.error(e);
      this.setStatus('loginStatus', 'Failed to send email. Check console for details.', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Send Verification Code';
    }
  }

  async resendOtp() {
    this.generatedOtp = this.makeOtp();
    this.otpExpiry    = Date.now() + this.OTP_VALID_MS;
    this.otpAttempts  = 0;
    const btn = $('resendOtpBtn');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await this.dispatchEmail(this.pendingEmail, this.generatedOtp);
      $$('.otp-digit').forEach(d => d.value = '');
      $$('.otp-digit')[0].focus();
      this.setStatus('otpStatus', 'New code sent!', 'success');
      this.startOtpTimer();
    } catch {
      this.setStatus('otpStatus', 'Failed to resend. Try again.', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Resend Code';
    }
  }

  async dispatchEmail(email, otp) {
    // Dev mode: just print to console
    if (typeof emailjs === 'undefined' || EMAILJS_CONFIG.publicKey === 'YOUR_PUBLIC_KEY') {
      console.log(`%c[DEV] OTP for ${email}: ${otp}`, 'background:#0d0d1a;color:#FFD93D;padding:4px 10px;border-radius:4px;font-size:15px;');
      this.setStatus('loginStatus', `[Dev mode] Code logged to console (F12): ${otp}`, 'info');
      return;
    }
    await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
      to_email: email,
      otp_code: otp,
      name: email.split('@')[0],
    });
  }

  verifyOtp() {
    const entered = Array.from($$('.otp-digit')).map(d => d.value).join('');
    if (entered.length < 6) { this.setStatus('otpStatus', 'Enter all 6 digits.', 'error'); return; }
    if (Date.now() > this.otpExpiry) { this.setStatus('otpStatus', 'Code has expired. Request a new one.', 'error'); return; }

    this.otpAttempts++;
    if (entered === this.generatedOtp) {
      this.generatedOtp = null;
      this.isHost = true;
      this.createSession(this.pendingEmail); // Create persistent session
      $('teacherDisplayEmail').textContent = this.pendingEmail;
      this.showScreen('teacherDashboard');
    } else {
      const left = this.MAX_ATTEMPTS - this.otpAttempts;
      if (left <= 0) {
        $$('.otp-digit').forEach(d => { d.value = ''; d.disabled = true; });
        $('verifyOtpBtn').disabled = true;
        this.setStatus('otpStatus', 'Too many wrong attempts. Request a new code.', 'error');
      } else {
        this.setStatus('otpStatus', `Incorrect. ${left} attempt${left > 1 ? 's' : ''} remaining.`, 'error');
        $$('.otp-digit').forEach(d => d.value = '');
        $$('.otp-digit')[0].focus();
      }
    }
  }

  refreshVerifyBtn() {
    $('verifyOtpBtn').disabled = !Array.from($$('.otp-digit')).every(d => d.value.length === 1);
  }

  startOtpTimer() {
    clearInterval(this._timerInterval);
    const el = $('otpTimer'), end = this.otpExpiry;
    const tick = () => {
      const rem = Math.max(0, end - Date.now());
      const m = Math.floor(rem / 60000), s = Math.floor((rem % 60000) / 1000);
      el.textContent = rem > 0 ? `Expires in ${m}:${s.toString().padStart(2,'0')}` : 'Code expired';
      el.style.color = rem < 60000 ? '#e74c3c' : '';
      if (!rem) clearInterval(this._timerInterval);
    };
    tick();
    this._timerInterval = setInterval(tick, 1000);
  }

  makeOtp() { return Math.floor(100000 + Math.random() * 900000).toString(); }

  logout() {
    this.isHost = false;
    this.pendingEmail = null;
    this.clearSession(); // Clear stored session
    this.showEmailStep();
    if (this.channel) { this.channel.close(); this.channel = null; }
    this.showScreen('loginScreen');
  }

  // ════════════════════════════════════════════
  // GAME MODE
  // ════════════════════════════════════════════
  setMode(mode) {
    this.gameMode = mode;
    $('teamModeBtn').classList.toggle('active', mode === 'teams');
    $('soloModeBtn').classList.toggle('active', mode === 'solo');
    $('teamConfig').style.display = mode === 'teams' ? '' : 'none';
  }

  adjustTeamCount(delta) {
    this.teamCount = Math.max(2, Math.min(8, this.teamCount + delta));
    $('teamCountDisplay').textContent = this.teamCount;
    this.buildTeamNameInputs();
  }

  buildTeamNameInputs() {
    const defaults = ['Team Alpha','Team Beta','Team Gamma','Team Delta','Team Epsilon','Team Zeta','Team Eta','Team Theta'];
    const container = $('teamNameInputs');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < this.teamCount; i++) {
      const row = document.createElement('div');
      row.className = 'team-name-row';
      const dot = document.createElement('span');
      dot.className = 'team-color-dot';
      dot.style.background = TEAM_COLOURS[i];
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'team-name-input';
      inp.value = defaults[i] || `Team ${i + 1}`;
      inp.dataset.teamIndex = i;
      inp.placeholder = `Team ${i + 1} name`;
      row.appendChild(dot);
      row.appendChild(inp);
      container.appendChild(row);
    }
  }

  buildTeams() {
    if (this.gameMode === 'solo') {
      this.teams = [];
      return;
    }
    this.teams = Array.from($$('.team-name-input')).map((inp, i) => ({
      id: `team_${i}`,
      name: inp.value.trim() || `Team ${i + 1}`,
      colour: TEAM_COLOURS[i],
    }));
  }

  // ════════════════════════════════════════════
  // EXCEL UPLOAD / DOWNLOAD
  // ════════════════════════════════════════════
  handleExcelUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const wb  = XLSX.read(evt.target.result, { type: 'array' });
        const ws  = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        // Skip header row (row 0), expect: Question | Answer | Points
        const questions = [];
        for (let i = 1; i < rows.length; i++) {
          const [q, a, pts] = rows[i];
          if (q && a) {
            questions.push({
              id: i,
              text: String(q).trim(),
              answer: String(a).trim(),
              points: parseInt(pts) || 2,
            });
          }
        }

        if (questions.length === 0) {
          this.showAlert('No questions found. Make sure your file has data below the header row.');
          return;
        }

        this.questions = questions;
        $('questionsCount').textContent = questions.length;
        $('questionsLoaded').classList.remove('hidden');
        this.renderQuestionsPreview();
        this.updateStartBtn();
      } catch (err) {
        console.error(err);
        this.showAlert('Could not read the file. Make sure it\'s a valid .xlsx file.');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ''; // reset so same file can be re-uploaded
  }

  downloadExcelTemplate() {
    try {
      const data = [
        ['Question', 'Answer', 'Points'],
        ['What is the capital of France?', 'Paris', 2],
        ['In what year did World War II end?', '1945', 2],
        ['What is the chemical symbol for Gold?', 'Au', 2],
      ];
      
      const ws = XLSX.utils.aoa_to_sheet(data);
      ws['!cols'] = [{ wch: 40 }, { wch: 25 }, { wch: 10 }];
      
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Questions');
      XLSX.writeFile(wb, 'questions_template.xlsx');
    } catch (err) {
      console.error(err);
      this.showAlert('Could not generate template. Make sure XLSX library is loaded.');
    }
  }

  renderQuestionsPreview() {
    const el = $('questionsPreview');
    el.innerHTML = '';
    el.classList.remove('hidden');
    this.questions.slice(0, 8).forEach(q => {
      const row = document.createElement('div');
      row.className = 'q-preview-row';
      row.innerHTML = `<span class="q-preview-q">${q.text}</span><span class="q-preview-a">${q.answer}</span>`;
      el.appendChild(row);
    });
    if (this.questions.length > 8) {
      const more = document.createElement('div');
      more.className = 'q-preview-row';
      more.innerHTML = `<span class="q-preview-q" style="color:#6b6b7a;font-style:italic">…and ${this.questions.length - 8} more</span>`;
      el.appendChild(more);
    }
  }

  // ════════════════════════════════════════════
  // LOBBY (BroadcastChannel — works across tabs
  //         on the same origin / same machine)
  // ════════════════════════════════════════════
  createRoom() {
    this.buildTeams();
    this.currentRoom = this.makeRoomCode();
    this.players = {};
    this.scores  = {};

    // Initialise scores
    if (this.gameMode === 'teams') {
      this.teams.forEach(t => this.scores[t.id] = 0);
    }

    // Open broadcast channel
    if (this.channel) this.channel.close();
    this.channel = new BroadcastChannel(`${CHANNEL_NAME}_${this.currentRoom}`);
    this.channel.onmessage = e => this.handleChannelMessage(e.data);

    $('roomCodeDisplay').textContent = this.currentRoom;
    $('lobbyInfo').classList.remove('hidden');
    $('createRoomBtn').disabled = true;
    $('createRoomBtn').textContent = 'Room Active';
    this.updateStartBtn();
  }

  makeRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  copyRoomCode() {
    navigator.clipboard.writeText(this.currentRoom).then(() => {
      $('copyCodeBtn').textContent = 'Copied!';
      setTimeout(() => $('copyCodeBtn').textContent = 'Copy', 1500);
    });
  }

  handleChannelMessage(msg) {
    switch (msg.type) {
      case 'JOIN':
        this.playerJoined(msg.name, msg.teamId || null);
        break;
      case 'REQUEST_INFO':
        // Student is asking for room configuration
        this.broadcast({
          type: 'ROOM_INFO',
          teams: this.teams,
          gameMode: this.gameMode,
        });
        break;
      case 'TEAM_SELECT':
        this.playerChangedTeam(msg.name, msg.teamId);
        break;
      case 'BUZZ':
        if (!this.buzzedBy && this.gameActive) {
          this.buzzedBy = msg.name;
          this.hostShowBuzz(msg.name, msg.teamId);
          // Notify all students
          this.broadcast({ type: 'BUZZED', name: msg.name, teamId: msg.teamId });
        }
        break;
    }
  }

  broadcast(msg) {
    if (this.channel) this.channel.postMessage(msg);
  }

  playerJoined(name, teamId) {
    this.players[name] = { teamId };
    if (this.gameMode === 'solo') this.scores[name] = this.scores[name] || 0;
    this.renderPlayerList();
    this.updateStartBtn();
  }

  playerChangedTeam(name, teamId) {
    if (this.players[name]) this.players[name].teamId = teamId;
    this.renderPlayerList();
    this.updateStartBtn();
  }

  renderPlayerList() {
    const el = $('playerList');
    el.innerHTML = '';
    const entries = Object.entries(this.players);
    if (entries.length === 0) {
      el.innerHTML = '<p class="waiting-text">Waiting for players to join…</p>';
      return;
    }
    entries.forEach(([name, data]) => {
      const chip = document.createElement('div');
      chip.className = 'player-chip';
      const team = this.teams.find(t => t.id === data.teamId);
      chip.innerHTML = `
        <span>${name}</span>
        ${team ? `<span class="player-team-tag" style="background:${team.colour}">${team.name}</span>` : ''}
      `;
      el.appendChild(chip);
    });
  }

  updateStartBtn() {
    const hasQ       = this.questions.length > 0;
    const hasPlayers = Object.keys(this.players).length > 0;
    const teamsOk    = this.gameMode === 'solo' || this.teams.every(t =>
      Object.values(this.players).some(p => p.teamId === t.id)
    );
    $('startGameBtn').disabled = !(hasQ && hasPlayers);
    // Show helpful text
    if (!hasQ) $('startGameBtn').textContent = 'Upload questions first';
    else if (!hasPlayers) $('startGameBtn').textContent = 'Waiting for players…';
    else $('startGameBtn').textContent = 'Start Game';
  }

  // ════════════════════════════════════════════
  // STUDENT JOIN
  // ════════════════════════════════════════════
  studentJoin() {
    const code = $('roomCodeInput').value.trim().toUpperCase();
    const name = $('studentUsername').value.trim();
    if (!code || !name) { this.setStatus('joinStatus', 'Enter both a room code and your name.', 'error'); return; }

    this.myName     = name;
    this.currentRoom = code;

    // Open channel
    if (this.channel) this.channel.close();
    this.channel = new BroadcastChannel(`${CHANNEL_NAME}_${code}`);
    this.channel.onmessage = e => this.handleStudentMessage(e.data);

    // Announce join — host will hear this
    this.broadcast({ type: 'JOIN', name });

    // Determine next screen — we listen for a ROOM_INFO reply within 1s
    // If no reply comes we still proceed (host may not be on same machine in local mode)
    this.awaitRoomInfo();
  }

  awaitRoomInfo() {
    // Ask host for room config
    this.broadcast({ type: 'REQUEST_INFO', name: this.myName });
    let resolved = false;

    const tmpHandler = e => {
      if (e.data.type === 'ROOM_INFO' && !resolved) {
        resolved = true;
        this.channel.removeEventListener('message', tmpHandler);
        this.applyRoomInfo(e.data);
      }
    };
    this.channel.addEventListener('message', tmpHandler);

    // Timeout: if host doesn't reply, the room is invalid
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        this.channel.removeEventListener('message', tmpHandler);
        this.channel.close();
        this.channel = null;
        this.setStatus('joinStatus', 'That room code doesn\'t exist. Check and try again.', 'error');
        $('roomCodeInput').value = '';
        $('studentUsername').value = '';
      }
    }, 1200);
  }

  applyRoomInfo(info) {
    // Restore team list from host data
    this.teams    = info.teams || [];
    this.gameMode = info.gameMode || 'solo';

    if (this.gameMode === 'teams' && this.teams.length > 0) {
      this.renderTeamSelectionScreen();
      this.showScreen('teamSelectionScreen');
    } else {
      $('waitScreenName').textContent = this.myName;
      this.showScreen('studentWaitScreen');
    }
  }

  handleStudentMessage(msg) {
    switch (msg.type) {
      case 'REQUEST_INFO':
        // Host tab responds with room config
        if (this.isHost) {
          this.broadcast({
            type: 'ROOM_INFO',
            teams: this.teams,
            gameMode: this.gameMode,
          });
        }
        break;
      case 'TEAM_SELECT_ACK':
        // Show waiting UI after selecting team
        $('waitingForHost').classList.remove('hidden');
        break;
      case 'GAME_START':
        this.receiveGameStart(msg);
        break;
      case 'NEXT_QUESTION':
        this.receiveQuestion(msg.question, msg.index);
        break;
      case 'BUZZED':
        if (this.gameMode === 'teams') {
          // Disable buzz for everyone
          $('buzzButton').disabled = true;
          if (msg.name === this.myName) {
            $('buzzedIndicator').classList.remove('hidden');
          }
        }
        break;
      case 'ANSWER_RESULT':
        this.receiveResult(msg);
        break;
      case 'SCORE_UPDATE':
        this.scores = msg.scores;
        if (!this.isHost) this.updateStudentScore();
        break;
      case 'GAME_END':
        this.scores = msg.scores;
        this.showResults();
        break;
    }
  }

  // ════════════════════════════════════════════
  // TEAM SELECTION SCREEN
  // ════════════════════════════════════════════
  renderTeamSelectionScreen() {
    const grid = $('teamsList');
    grid.innerHTML = '';
    this.teams.forEach(team => {
      const btn = document.createElement('button');
      btn.className = 'team-select-btn';
      btn.innerHTML = `
        <span class="tsb-color" style="background:${team.colour}"></span>
        <span class="tsb-name">${team.name}</span>
        <span class="tsb-count" id="tc_${team.id}">0 players</span>
      `;
      btn.onclick = () => this.selectTeam(team, btn);
      grid.appendChild(btn);
    });
  }

  selectTeam(team, btn) {
    this.myTeamId = team.id;
    $$('.team-select-btn').forEach(b => b.classList.remove('chosen'));
    btn.classList.add('chosen');
    this.broadcast({ type: 'TEAM_SELECT', name: this.myName, teamId: team.id });
    setTimeout(() => $('waitingForHost').classList.remove('hidden'), 300);
  }

  // ════════════════════════════════════════════
  // START GAME (HOST)
  // ════════════════════════════════════════════
  startGame() {
    if (!this.questions.length) return;
    this.gameActive    = true;
    this.currentQIdx   = 0;
    this.buzzedBy      = null;

    const startMsg = {
      type: 'GAME_START',
      gameMode: this.gameMode,
      teams: this.teams,
      scores: this.scores,
    };
    this.broadcast(startMsg);

    this.showScreen('gameScreen');
    $('hostView').classList.remove('hidden');
    $('studentView').classList.add('hidden');
    this.displayHostQuestion();
    this.renderScoreboard();
  }

  // ════════════════════════════════════════════
  // STUDENT: RECEIVE GAME START
  // ════════════════════════════════════════════
  receiveGameStart(msg) {
    this.gameMode = msg.gameMode;
    this.teams    = msg.teams || [];
    this.scores   = msg.scores || {};
    this.gameActive = true;

    this.showScreen('gameScreen');
    $('hostView').classList.add('hidden');
    $('studentView').classList.remove('hidden');

    // Set team name display
    const myTeam = this.teams.find(t => t.id === this.myTeamId);
    $('studentTeamName').textContent = myTeam ? myTeam.name : (this.myName || 'You');
    $('studentTeamName').style.color = myTeam ? myTeam.colour : '#FFD93D';

    $('buzzButton').disabled = false;
    $('buzzedIndicator').classList.add('hidden');
    $('resultMessage').classList.add('hidden');
  }

  // ════════════════════════════════════════════
  // QUESTIONS (HOST SIDE)
  // ════════════════════════════════════════════
  displayHostQuestion() {
    if (this.currentQIdx >= this.questions.length) { this.endGame(); return; }

    const q = this.questions[this.currentQIdx];
    $('questionNumber').textContent  = `Q${this.currentQIdx + 1}`;
    $('questionText').textContent    = '';  // Start blank
    $('questionCategory').textContent = '';
    $('questionCategory').style.display = 'none';
    $('answerReveal').classList.add('hidden');
    $('correctAnswerDisplay').textContent = '';
    $('buzzStatusBox').innerHTML = '<span class="buzz-waiting">Waiting for buzz…</span>';
    this.buzzedBy = null;
    this.questionRevealed = false;
    this.answerRevealed = false;
  
    // Show blank question initially - students don't see it yet
    this.broadcast({ type: 'NEXT_QUESTION', question: { text: '' }, index: this.currentQIdx });
  }

  revealQuestion() {
    if (this.questionRevealed) return;
  
    const q = this.questions[this.currentQIdx];
    $('questionText').textContent = q.text;
    this.questionRevealed = true;
  
    // Send full question to students
    this.broadcast({ 
      type: 'NEXT_QUESTION', 
      question: { text: q.text }, 
  }
  
  const q = this.questions[this.currentQIdx];
  $('correctAnswerDisplay').textContent = q.answer;
  $('answerReveal').classList.remove('hidden');
  this.answerRevealed = true;
}

markAnswer(correct) {
    if (!this.buzzedBy && this.gameMode !== 'solo') {
      // In solo mode we mark without buzz
    }

    const q = this.questions[this.currentQIdx];
    const pts = correct ? q.points : -1;

    if (this.gameMode === 'teams' && this.myTeamId) {
      // Find the team of the buzzer
      const buzzerData = this.players[this.buzzedBy];
      const scoreKey   = buzzerData?.teamId || Object.keys(this.scores)[0];
      this.scores[scoreKey] = (this.scores[scoreKey] || 0) + pts;
    } else if (this.buzzedBy) {
      this.scores[this.buzzedBy] = (this.scores[this.buzzedBy] || 0) + pts;
    }

    this.broadcast({ type: 'ANSWER_RESULT', correct, points: pts, buzzedBy: this.buzzedBy });
    this.broadcast({ type: 'SCORE_UPDATE', scores: this.scores });
    this.renderScoreboard();
    this.buzzedBy = null;
    $('buzzStatusBox').innerHTML = '<span class="buzz-waiting">Waiting for buzz…</span>';
  }

  nextQuestion() {
    this.currentQIdx++;
    this.questionRevealed = false;
    this.answerRevealed = false;
    this.displayHostQuestion();
    this.broadcast({ type: 'BUZZ_RESET' });
  }

  renderScoreboard() {
    const el = $('scoresList');
    el.innerHTML = '';
    const entries = Object.entries(this.scores).sort((a, b) => b[1] - a[1]);
    const topScore = entries[0]?.[1];

    entries.forEach(([id, pts]) => {
      const team = this.teams.find(t => t.id === id);
      const name = team ? team.name : id;
      const colour = team ? team.colour : '#FFD93D';
      const row = document.createElement('div');
      row.className = 'score-row' + (pts === topScore && pts > 0 ? ' leading' : '');
      row.innerHTML = `
        <span style="display:flex;align-items:center;gap:0.5rem;">
          <span style="width:10px;height:10px;border-radius:50%;background:${colour};display:inline-block;border:1.5px solid #fff;"></span>
          ${name}
        </span>
        <span class="score-pts">${pts}</span>
      `;
      el.appendChild(row);
    });
  }

  // ════════════════════════════════════════════
  // STUDENT SIDE
  // ════════════════════════════════════════════
  receiveQuestion(q, index) {
    $('studentQuestionNumber').textContent = `Q${index + 1}`;
    $('studentQuestionText').textContent   = q.text;
    $('buzzButton').disabled = false;
    $('buzzedIndicator').classList.add('hidden');
    $('resultMessage').classList.add('hidden');
  }

  buzzIn() {
    if (!this.gameActive) return;
    
    // Prevent buzzing if in teams mode but no team selected
    if (this.gameMode === 'teams' && !this.myTeamId) {
      this.showAlert('You must select a team before you can buzz in!');
      return;
    }
    
    $('buzzButton').disabled = true;
    this.broadcast({ type: 'BUZZ', name: this.myName, teamId: this.myTeamId });
  }

  receiveResult(msg) {
    const el = $('resultMessage');
    el.classList.remove('hidden', 'correct', 'incorrect');
    el.textContent = msg.correct
      ? `✓ Correct! +${msg.points} pts`
      : `✗ Incorrect! ${msg.points} pts`;
    el.classList.add(msg.correct ? 'correct' : 'incorrect');
    $('buzzButton').disabled = false;
    $('buzzedIndicator').classList.add('hidden');
    this.updateStudentScore();
  }

  updateStudentScore() {
    const key = this.myTeamId || this.myName;
    $('teamScoreDisplay').textContent = this.scores[key] ?? 0;
  }

  // ════════════════════════════════════════════
  // END GAME & RESULTS
  // ════════════════════════════════════════════
  endGame() {
    this.gameActive = false;
    this.broadcast({ type: 'GAME_END', scores: this.scores });
    this.showResults();
  }

  showResults() {
    this.showScreen('resultsScreen');
    const el = $('resultsList');
    el.innerHTML = '';

    const entries = Object.entries(this.scores)
      .map(([id, pts]) => {
        const team = this.teams.find(t => t.id === id);
        return { name: team ? team.name : id, pts, colour: team?.colour };
      })
      .sort((a, b) => b.pts - a.pts);

    const medals = ['🥇','🥈','🥉'];
    entries.forEach((e, i) => {
      const card = document.createElement('div');
      card.className = 'result-card' + (i === 0 ? ' winner' : '');
      card.innerHTML = `
        <span class="result-rank">${medals[i] || `#${i+1}`}</span>
        <span class="result-name" style="border-left:4px solid ${e.colour||'#FFD93D'};padding-left:0.75rem;">${e.name}</span>
        <span class="result-score">${e.pts} pts</span>
      `;
      el.appendChild(card);
    });
  }

  // ════════════════════════════════════════════
  // RESET
  // ════════════════════════════════════════════
  resetGame() {
    clearInterval(this._timerInterval);
    if (this.channel) { this.channel.close(); this.channel = null; }
    this.questions     = [];
    this.currentQIdx   = 0;
    this.scores        = {};
    this.players       = {};
    this.buzzedBy      = null;
    this.gameActive    = false;
    this.currentRoom   = null;
    this.myTeamId      = null;
    this.myName        = null;
    $('createRoomBtn').disabled    = false;
    $('createRoomBtn').textContent = 'Create Room';
    $('lobbyInfo').classList.add('hidden');
    $('questionsLoaded').classList.add('hidden');
    $('questionsPreview').classList.add('hidden');
    $('hostView').classList.add('hidden');
    $('studentView').classList.add('hidden');
    
    // Return to lobby if teacher, otherwise to login
    if (this.isHost) {
      this.showScreen('teacherDashboard');
    } else {
      this.showScreen('loginScreen');
    }
  }

  // ════════════════════════════════════════════
  // UTILITIES
  // ════════════════════════════════════════════
  setStatus(id, msg, type) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg;
    el.className = `status-msg status-${type}`;
    el.classList.remove('hidden');
  }
  clearStatus(id) { const el=$(id); if(el){el.textContent='';el.classList.add('hidden');} }
  showAlert(msg)  { alert(msg); }
}

// ── Helpers ───────────────────────────────────
const $  = id  => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

window.addEventListener('DOMContentLoaded', () => new UniversityChallenge());