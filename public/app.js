const socket = io();
let stream = null;
let targetLanguage = 'EN';
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
let userName = '';

// Fetch user info
fetch('/check-auth')
    .then(response => response.json())
    .then(data => {
        if (data.authenticated && data.user) {
            userName = data.user.name;
            document.getElementById('user-name').textContent = userName;
        }
    });

// Logout functionality
logoutButton.addEventListener('click', async () => {
    try {
        const response = await fetch('/logout', {
            method: 'POST'
        });
        if (response.ok) {
            window.location.href = '/login.html';
        }
    } catch (error) {
        console.error('Logout error:', error);
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

function endCall() {
    isInCall = false;
    callUserButton.textContent = '📞 Call';
    callUserButton.classList.remove('calling');
    ringtone.pause();
    ringtone.currentTime = 0;
}

// Socket event handlers
socket.on('call request', (data) => {
    showNotification(`${data.caller} is calling...`, true);
    ringtone.play();
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
    hangupSound.play();
    showNotification('Call ended');
});

// Photo functionality
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

socket.on('photo', (photoData) => {
    remotePhoto.src = photoData;
    updatePhotoBoxStyle(remotePhoto, true);
});

// Chat functionality
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

function addMessageToChat(data, isOwnMessage) {
    const messageContainer = document.createElement('div');
    messageContainer.classList.add('message-container');
    if (isOwnMessage) {
        messageContainer.classList.add('own-message');
    }

    const messageText = document.createElement('span');
    messageText.classList.add('message-text');
    messageText.textContent = data.message;
    messageContainer.appendChild(messageText);

    if (data.translation) {
        const translatedText = document.createElement('span');
        translatedText.classList.add('translated-text');
        translatedText.textContent = data.translation;
        messageContainer.appendChild(translatedText);
    }

    chatMessages.appendChild(messageContainer);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

socket.on('chat message', (data) => {
    if (!data.isOwnMessage) {
        addMessageToChat(data, false);
        if (!document.hasFocus()) {
            messageSound.play();
        }
    }
});

// Language selection
languageSelect.addEventListener('change', (event) => {
    targetLanguage = event.target.value.toUpperCase();
    socket.emit('set language', targetLanguage);
});

// Initialize
function initializeSounds() {
    document.addEventListener('click', () => {
        if (ringtone.paused && messageSound.paused) {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioContext.resume();
        }
    }, { once: true });
}

document.addEventListener('DOMContentLoaded', () => {
    updatePhotoBoxStyle(localPhoto, false);
    updatePhotoBoxStyle(remotePhoto, false);
    initializeSounds();
    takePhotoButton.disabled = true;
});