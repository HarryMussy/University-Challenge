class UniversityChallenge {
	constructor() {
		this.userType = null; // 'teacher' or 'student'
		this.isHost = false;
		this.currentRoom = null;
		this.currentTeam = null;
		this.questions = [];
		this.currentQuestionIndex = 0;
		this.teams = [];
		this.students = {};
		this.scores = {};
		this.buzzedStudent = null;
		this.gameActive = false;

		this.initEventListeners();
	}

	// Navigation
	initEventListeners() {
		// Login screen
		document.getElementById('teacherLoginBtn').addEventListener('click', () => this.showScreen('teacherLoginScreen'));
		document.getElementById('studentJoinBtn').addEventListener('click', () => this.showScreen('studentJoinScreen'));

		// Teacher login
		document.getElementById('teacherLoginSubmit').addEventListener('click', () => this.teacherLogin());
		document.getElementById('backToMainBtn').addEventListener('click', () => this.showScreen('loginScreen'));
		document.getElementById('backToMainBtn2').addEventListener('click', () => this.showScreen('loginScreen'));

		// Teacher dashboard
		document.getElementById('createRoomBtn').addEventListener('click', () => this.createRoom());
		document.getElementById('loadQuestionsBtn').addEventListener('click', () => this.loadQuestions());
		document.getElementById('startGameBtn').addEventListener('click', () => this.startGame());

		// Student join
		document.getElementById('joinRoomBtn').addEventListener('click', () => this.studentJoinRoom());

		// Game controls
		document.getElementById('correctBtn').addEventListener('click', () => this.markAnswer(true));
		document.getElementById('incorrectBtn').addEventListener('click', () => this.markAnswer(false));
		document.getElementById('nextQuestionBtn').addEventListener('click', () => this.nextQuestion());

		// Buzz button
		document.getElementById('buzzButton').addEventListener('click', () => this.buzzIn());

		// Results
		document.getElementById('playAgainBtn').addEventListener('click', () => this.resetGame());
	}

	showScreen(screenId) {
		document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
		document.getElementById(screenId).classList.add('active');
	}

	// Teacher Functions
	teacherLogin() {
		const email = document.getElementById('teacherEmail').value;
		if (email.includes('@microsoft.com') || email.includes('@outlook.com')) {
			this.userType = 'teacher';
			this.isHost = true;
			this.showScreen('teacherDashboard');
		} else {
			alert('Please use a valid Microsoft email');
		}
	}
    

	createRoom() {
		this.currentRoom = this.generateRoomCode();
		document.getElementById('currentRoom').classList.remove('hidden');
		document.getElementById('roomCode').textContent = this.currentRoom;
		document.getElementById('studentCount').textContent = '0';
		document.getElementById('startGameBtn').disabled = true;

		// Simulate socket connection - in real app, use WebSocket
		console.log('Room created:', this.currentRoom);
	}

	generateRoomCode() {
		return Math.random().toString(36).substring(2, 8).toUpperCase();
	}

	loadQuestions() {
		// Placeholder - in real app, fetch from database/Excel
		this.questions = [
			{ id: 1, text: 'What is the chemical symbol for gold?', answer: 'Au' },
			{ id: 2, text: 'How many sides does a hexagon have?', answer: '6' },
			{ id: 3, text: 'What is the powerhouse of the cell?', answer: 'Mitochondria' },
			{ id: 4, text: 'What is the smallest prime number?', answer: '2' },
			{ id: 5, text: 'In which organ does photosynthesis occur?', answer: 'Leaf/Chloroplast' }
		];
		alert(`Loaded ${this.questions.length} questions`);
		document.getElementById('startGameBtn').disabled = this.questions.length === 0;
	}

	// Student Functions
	studentJoinRoom() {
		const roomCode = document.getElementById('roomCodeInput').value.toUpperCase();
		const username = document.getElementById('studentUsername').value;

		if (!roomCode || !username) {
			alert('Please enter room code and username');
			return;
		}

		this.userType = 'student';
		this.isHost = false;
		this.currentRoom = roomCode;
		this.students[username] = { username, team: null };

		// In real app, verify room exists via WebSocket
		this.showScreen('teamSelectionScreen');
		this.displayTeams();
	}

	displayTeams() {
		// Placeholder teams - in real app, fetch from database
		this.teams = [
			{ id: 1, name: 'Team Alpha' },
			{ id: 2, name: 'Team Beta' },
			{ id: 3, name: 'Team Gamma' },
			{ id: 4, name: 'Team Delta' }
		];

		const teamsList = document.getElementById('teamsList');
		teamsList.innerHTML = '';

		this.teams.forEach(team => {
			const btn = document.createElement('button');
			btn.textContent = team.name;
			btn.className = 'btn btn-primary team-btn';
			btn.addEventListener('click', () => this.selectTeam(team));
			teamsList.appendChild(btn);
		});
	}

	selectTeam(team) {
		this.currentTeam = team;
		this.scores[team.id] = this.scores[team.id] || 0;

		document.querySelectorAll('.team-btn').forEach(btn => btn.classList.remove('selected'));
		event.target.classList.add('selected');
		document.getElementById('startGameStudentBtn').disabled = false;
	}

	// Game Functions
	startGame() {
		if (!this.questions.length) {
			alert('Please load questions first');
			return;
		}

		this.gameActive = true;
		this.currentQuestionIndex = 0;

		this.showScreen('gameScreen');

		if (this.isHost) {
			document.getElementById('hostView').classList.remove('hidden');
			document.getElementById('studentView').classList.add('hidden');
			this.displayQuestion(true);
			this.updateScoreboard();
		} else {
			document.getElementById('hostView').classList.add('hidden');
			document.getElementById('studentView').classList.remove('hidden');
			document.getElementById('studentTeamName').textContent = this.currentTeam.name;
			document.getElementById('buzzButton').disabled = false;
			this.displayQuestion(false);
		}
	}

	displayQuestion(isHost = true) {
		if (this.currentQuestionIndex >= this.questions.length) {
			this.endGame();
			return;
		}

		const question = this.questions[this.currentQuestionIndex];

		if (isHost) {
			document.getElementById('questionNumber').textContent = `Question ${this.currentQuestionIndex + 1}`;
			document.getElementById('questionText').textContent = question.text;
		} else {
			document.getElementById('studentQuestionNumber').textContent = `Question ${this.currentQuestionIndex + 1}`;
			document.getElementById('studentQuestionText').textContent = question.text;
			document.getElementById('buzzButton').disabled = false;
			document.getElementById('buzzedIndicator').classList.add('hidden');
			document.getElementById('resultMessage').classList.add('hidden');
		}

		this.buzzedStudent = null;
	}

	buzzIn() {
		if (!this.gameActive || this.buzzedStudent) return;

		this.buzzedStudent = this.currentTeam.id;
		document.getElementById('buzzButton').disabled = true;
		document.getElementById('buzzedIndicator').classList.remove('hidden');

		// In real app, send buzz notification to host
		console.log('Buzzed in:', this.currentTeam.name);
	}

	markAnswer(isCorrect) {
		if (!this.buzzedStudent) {
			alert('No one has buzzed in');
			return;
		}

		const points = isCorrect ? 2 : -1;
		this.scores[this.buzzedStudent] = (this.scores[this.buzzedStudent] || 0) + points;

		// Update student view with result
		const studentResult = document.getElementById('resultMessage');
		studentResult.classList.remove('hidden', 'correct', 'incorrect');
		studentResult.textContent = isCorrect ? '✓ CORRECT! +2 Points' : '✗ INCORRECT! -1 Point';
		studentResult.classList.add(isCorrect ? 'correct' : 'incorrect');

		document.getElementById('teamScoreDisplay').textContent = this.scores[this.buzzedStudent];

		this.updateScoreboard();
		this.buzzedStudent = null;
	}

	updateScoreboard() {
		const scoresList = document.getElementById('scoresList');
		scoresList.innerHTML = '';

		Object.entries(this.scores).forEach(([teamId, score]) => {
			const team = this.teams.find(t => t.id == teamId);
			if (team) {
				const item = document.createElement('div');
				item.className = 'score-item';
				item.innerHTML = `<span>${team.name}</span><span>${score}</span>`;
				scoresList.appendChild(item);
			}
		});
	}

	nextQuestion() {
		this.currentQuestionIndex++;
		this.displayQuestion(true);
	}

	endGame() {
		this.gameActive = false;
		this.displayResults();
	}

	displayResults() {
		this.showScreen('resultsScreen');

		const resultsList = document.getElementById('resultsList');
		resultsList.innerHTML = '';

		const sortedScores = Object.entries(this.scores)
			.map(([teamId, score]) => ({
				teamId,
				team: this.teams.find(t => t.id == teamId),
				score
			}))
			.sort((a, b) => b.score - a.score);

		sortedScores.forEach((item, index) => {
			const card = document.createElement('div');
			card.className = 'result-card' + (index === 0 ? ' winner' : '');
			card.innerHTML = `
				${index === 0 ? '<div class="winner-badge">🏆</div>' : ''}
				<div class="result-team-name">${item.team.name}</div>
				<div class="result-score">${item.score} pts</div>
			`;
			resultsList.appendChild(card);
		});
	}

	resetGame() {
		this.currentQuestionIndex = 0;
		this.buzzedStudent = null;
		this.scores = {};
		this.teams.forEach(team => this.scores[team.id] = 0);
		this.gameActive = false;
		this.showScreen('loginScreen');
	}
}

// Initialize game when page loads
window.addEventListener('DOMContentLoaded', () => {
	new UniversityChallenge();
});