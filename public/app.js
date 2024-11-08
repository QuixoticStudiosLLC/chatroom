const socket = io();
let stream = null;
let targetLanguage = 'EN';
let savedLanguage = 'EN';
let userName = '';
let isInCall = false;

// DOM Elements
const cameraPreview = document.getElementById('camera-preview');
const localPhoto = document.getElementById('local-photo');
const remotePhoto = document.getElementById('remote-photo');
const startCameraButton = document.getElementById('start-camera');
const takePhotoButton = document.getElementById('take-photo');
const sendPhotoButton = document.getElementById('send-photo');
const savePhotoButton = document.getElementById('save-photo');
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const languageSelect = document.getElementById('language-select');
const logoutButton = document.getElementById('logout-button');
const callUserButton = document.getElementById('call-user-button');
const notification = document.getElementById('notification');
const notificationText = document.getElementById('notification-text');
const acceptCallButton = document.getElementById('accept-call');
const declineCallButton = document.getElementById('decline-call');
const ringtone = document.getElementById('ringtone');
const hangupSound = document.getElementById('hangupSound');
const messageSound = document.getElementById('messageSound');

// Auth check
fetch('/check-auth', {
    credentials: 'same-origin',
    headers: {
        'Cache-Control': 'no-cache'
    }
})
.then(response => response.json())
.then(data => {
    console.log('Auth check response:', data);
    if (!data.authenticated) {
        window.location.replace('/login.html');
    } else {
        userName = data.user.name;
        document.getElementById('user-name').textContent = userName;
        
        // Set language and update UI
        if (data.user.language) {
            console.log('Setting saved language:', data.user.language);
            targetLanguage = data.user.language;
            languageSelect.value = data.user.language;
            socket.emit('set language', {
                language: data.user.language,
                userId: socket.id
            });
        }
    }
})
.catch(error => {
    console.error('Auth check error:', error);
    window.location.replace('/login.html');
});

// Camera functionality
function updatePhotoBoxStyle(photoElement, hasPhoto) {
    const photoBox = photoElement.parentElement;
    if (hasPhoto) {
        photoBox.classList.add('has-photo');
        photoElement.style.display = 'block';
    } else {
        photoBox.classList.remove('has-photo');
        photoElement.style.display = 'none';
    }
}

startCameraButton.addEventListener('click', async () => {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        cameraPreview.srcObject = stream;
        cameraPreview.style.display = 'block';
        localPhoto.style.display = 'none';
        updatePhotoBoxStyle(localPhoto, false);
        takePhotoButton.disabled = false;
    } catch (err) {
        console.error('Error accessing camera:', err);
        alert('Could not access camera');
    }
});

takePhotoButton.addEventListener('click', () => {
    const canvas = document.createElement('canvas');
    canvas.width = cameraPreview.videoWidth;
    canvas.height = cameraPreview.videoHeight;
    canvas.getContext('2d').drawImage(cameraPreview, 0, 0);
    localPhoto.src = canvas.toDataURL('image/jpeg');
    localPhoto.style.display = 'block';
    cameraPreview.style.display = 'none';
    updatePhotoBoxStyle(localPhoto, true);
    
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
});

sendPhotoButton.addEventListener('click', () => {
    if (localPhoto.src) {
        socket.emit('photo', localPhoto.src);
    }
});

savePhotoButton.addEventListener('click', () => {
    if (remotePhoto.src) {
        const link = document.createElement('a');
        link.download = 'partner-photo.jpg';
        link.href = remotePhoto.src;
        link.click();
    }
});

// Chat functionality
function addMessageToChat(data, isOwnMessage) {
    console.log('Adding message to chat:', data);
    const messageContainer = document.createElement('div');
    messageContainer.classList.add('message-container');
    if (isOwnMessage) {
        messageContainer.classList.add('own-message');
    }

    // Add message text
    const messageText = document.createElement('span');
    messageText.classList.add('message-text');
    messageText.textContent = data.message;
    messageContainer.appendChild(messageText);

    // Show language info and translation if available
    const infoText = document.createElement('span');
    infoText.classList.add('message-info');
    if (data.sourceLanguage) {
        infoText.textContent = `(${data.sourceLanguage})`;
        messageContainer.appendChild(infoText);
    }

    // Add translation if available
    if (data.translation) {
        const translatedText = document.createElement('span');
        translatedText.classList.add('translated-text');
        translatedText.textContent = `Translation: ${data.translation}`;
        messageContainer.appendChild(translatedText);
    }

    // Show error if translation failed
    if (data.error) {
        const errorText = document.createElement('span');
        errorText.classList.add('error-text');
        errorText.textContent = data.error;
        messageContainer.appendChild(errorText);
    }

    chatMessages.appendChild(messageContainer);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (chatInput.value.trim()) {
        const messageData = {
            message: chatInput.value,
            userName: userName
        };
        socket.emit('chat message', messageData);
        addMessageToChat({ message: chatInput.value }, true);
        chatInput.value = '';
    }
});

// Call functionality
function showNotification(message, buttons = null) {
    notificationText.textContent = message;
    const buttonContainer = document.querySelector('.notification-buttons');
    buttonContainer.style.display = buttons ? 'flex' : 'none';
    
    if (!buttons) {
        notification.style.display = 'block';
        setTimeout(() => {
            notification.style.display = 'none';
        }, 3000);
    } else {
        notification.style.display = 'block';
    }
}

function endCall() {
    isInCall = false;
    callUserButton.textContent = '📞 Call';
    callUserButton.classList.remove('calling');
    ringtone.pause();
    ringtone.currentTime = 0;
}

// Socket event handlers
socket.on('connect', () => {
    console.log('Connected to server, emitting online status');
    socket.emit('user status', { status: 'online' });
});

socket.on('user status update', (data) => {
    console.log('Received status update:', data);
    if (data.status === 'online') {
        callUserButton.classList.add('pulse');
        onlineStatus.textContent = 'Online';
        onlineStatus.classList.add('online');
    } else {
        callUserButton.classList.remove('pulse');
        onlineStatus.textContent = 'Offline';
        onlineStatus.classList.remove('online');
    }
});

socket.on('chat message', (data) => {
    if (!data.isOwnMessage) {
        addMessageToChat(data, false);
        if (!document.hasFocus()) {
            messageSound.play();
        }
    }
});

socket.on('photo', (photoData) => {
    remotePhoto.src = photoData;
    updatePhotoBoxStyle(remotePhoto, true);
});

socket.on('call request', (data) => {
    showNotification(`${data.caller} is calling...`, true);
    ringtone.play().catch(error => {
        console.error('Error playing ringtone:', error);
        // Try to re-enable audio
        enableSounds();
        // Try playing again
        ringtone.play().catch(console.error);
    });
});

socket.on('call accepted', (data) => {
    isInCall = true;
    callUserButton.textContent = '📞 End Call';
    showNotification(`${data.accepter} accepted the call`);
});

socket.on('call declined', (data) => {
    showNotification(`${data.decliner} declined the call`);
    endCall();
});

socket.on('call ended', () => {
    endCall();
    hangupSound.play().catch(error => {
        console.error('Error playing hangup sound:', error);
        enableSounds();
        hangupSound.play().catch(console.error);
    });
    showNotification('Call ended');
});

// Call button handlers
callUserButton.addEventListener('click', () => {
    if (!isInCall) {
        socket.emit('call request', { caller: userName });
        callUserButton.textContent = '📞 Calling...';
        callUserButton.classList.add('calling');
    } else {
        socket.emit('end call');
        endCall();
    }
});

acceptCallButton.addEventListener('click', () => {
    notification.style.display = 'none';
    ringtone.pause();
    ringtone.currentTime = 0;
    socket.emit('call accepted', { accepter: userName });
    isInCall = true;
    callUserButton.textContent = '📞 End Call';
    callUserButton.classList.add('calling');
});

declineCallButton.addEventListener('click', () => {
    notification.style.display = 'none';
    ringtone.pause();
    ringtone.currentTime = 0;
    socket.emit('call declined', { decliner: userName });
});

// Language selection
languageSelect.addEventListener('change', async (event) => {
    const newLanguage = event.target.value.toUpperCase();
    console.log('Language change requested:', newLanguage);
    targetLanguage = newLanguage;
    
    try {
        // Save to server
        const response = await fetch('/set-language', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin',
            body: JSON.stringify({ language: newLanguage })
        });
        
        const data = await response.json();
        console.log('Language save response:', data);
        
        if (data.success) {
            // Emit to socket with explicit data
            socket.emit('set language', {
                language: newLanguage,
                userId: socket.id
            });
            console.log('Socket language updated to:', newLanguage);
        }
    } catch (error) {
        console.error('Error saving language preference:', error);
    }
});

// Logout functionality
logoutButton.addEventListener('click', async () => {
    try {
        const response = await fetch('/logout', {
            method: 'POST',
            credentials: 'same-origin'
        });
        if (response.ok) {
            window.location.replace('/login.html');
        }
    } catch (error) {
        console.error('Logout error:', error);
    }
});

// Initialize
function initializeSounds() {
    // Pre-load sounds
    ringtone.load();
    hangupSound.load();
    messageSound.load();

    // Enable sounds on first user interaction
    document.addEventListener('touchstart', enableSounds, { once: true });
    document.addEventListener('click', enableSounds, { once: true });
}

function enableSounds() {
    // Create context for iOS
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audioContext = new AudioContext();
    
    // Enable each sound
    [ringtone, hangupSound, messageSound].forEach(sound => {
        sound.play().then(() => {
            sound.pause();
            sound.currentTime = 0;
        }).catch(console.error);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    updatePhotoBoxStyle(localPhoto, false);
    updatePhotoBoxStyle(remotePhoto, false);
    initializeSounds();
    takePhotoButton.disabled = true;
});

// Initial language setup
socket.emit('set language', targetLanguage);