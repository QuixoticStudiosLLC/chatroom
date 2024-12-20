require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { createClient } = require('redis');
const RedisStore = require('connect-redis').default;
const path = require('path');
const fs = require('fs');

const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: ["https://chatroom.quixotic-studios.com", "http://chatroom.quixotic-studios.com"],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});
const dailyTranslationCount = new Map();
const DAILY_LIMIT = 1000; // Adjust this number
const CHAR_LIMIT = 200;   // Limit characters per message
let monthlyCharCount = 0;
const MONTHLY_FREE_LIMIT = 500000;

// Reset counts daily
function resetDailyCounts() {
    dailyTranslationCount.clear();
}
// Reset at midnight
setInterval(resetDailyCounts, 24 * 60 * 60 * 1000);

// Add error handling for the Socket.IO server
io.engine.on("connection_error", (err) => {
    console.log('Socket.IO connection error:', err);
});
// Google Translate
const { Translate } = require('@google-cloud/translate').v2;
//const translate = new Translate({key: process.env.GOOGLE_TRANSLATE_API_KEY});

// Initialize with explicit settings
const translate = new Translate({
    projectId: 'valiant-surfer-432316-v6', // Add your Google Cloud project ID
    key: process.env.GOOGLE_TRANSLATE_API_KEY,
    headers: {
        'Referer': 'https://chatroom.quixotic-studios.com'
    }
});

// Add a simple rate limiter
const translationCooldown = new Map();
const COOLDOWN_MS = 1000; // 1 second between translations

// Add this test function
async function testTranslation() {
    try {
        console.log('Testing translation API...');
        console.log('API Key present:', !!process.env.GOOGLE_TRANSLATE_API_KEY);
        const [translation] = await translate.translate('Hello', 'UK');
        console.log('Test translation successful:', translation);
    } catch (error) {
        console.error('Translation test failed:', {
            error: error.message,
            code: error.code,
            details: error.response?.data
        });
    }
}
// Call it when server starts
testTranslation();

// Redis setup
const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
        tls: false,
        rejectUnauthorized: false
    }
});

redisClient.connect().catch(console.error);

redisClient.on('connect', () => {
    console.log('Connected to Redis');
    // Test Redis functionality
    redisClient.set('test', 'working').then(() => {
        console.log('Redis write test successful');
    });
});

// Session configuration
const sessionConfig = {
    store: new RedisStore({ 
        client: redisClient,
        prefix: "sess:"
    }),
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
        sameSite: 'lax'
    },
    name: 'sessionId'
};

if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
    sessionConfig.cookie.secure = true;
}

app.use(session(sessionConfig));
app.use(express.json());
app.use(express.static('public'));

// Request logging middleware
app.use((req, res, next) => {
    console.log('Request:', {
        url: req.url,
        method: req.method,
        sessionID: req.sessionID,
        hasSession: !!req.session,
        sessionUser: req.session?.user
    });
    next();
});

// Routes
app.get('/', (req, res) => {
    if (req.session?.user) {
        res.redirect('/index.html');
    } else {
        res.redirect('/login.html');
    }
});

// Login endpoint
app.post('/login', async (req, res) => {
    const { email } = req.body;
    console.log('Login attempt for email:', email);
    
    try {
        const usersPath = path.join(__dirname, 'users.json');
        const usersData = fs.readFileSync(usersPath, 'utf8');
        const users = JSON.parse(usersData);
        
        const user = users.users.find(u => u.email === email);
        
        if (user) {
            // Read existing language preference from users.json or default to 'EN'
            user.language = user.language || 'EN';
            
            // Set session data
            req.session.user = {
                email: user.email,
                name: user.name,
                language: user.language
            };

            // Save user language preference back to users.json
            const updatedUsers = users.users.map(u => 
                u.email === email ? { ...u, language: user.language } : u
            );
            fs.writeFileSync(usersPath, JSON.stringify({ users: updatedUsers }, null, 2));

            await new Promise((resolve, reject) => {
                req.session.save((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            console.log('Login successful with language:', user.language);
            res.sendStatus(200);
        } else {
            res.sendStatus(401);
        }
    } catch (error) {
        console.error('Login error:', error);
        res.sendStatus(500);
    }
});

// Check auth endpoint
app.get('/check-auth', (req, res) => {
    console.log('Auth check request:', {
        session: req.session,
        user: req.session?.user,
        language: req.session?.user?.language
    });
    
    if (req.session?.user) {
        res.json({
            authenticated: true,
            user: req.session.user
        });
    } else {
        res.json({ authenticated: false });
    }
});

// Save Language endpoint
app.post('/set-language', async (req, res) => {
    if (req.session?.user) {
        const newLanguage = req.body.language;
        req.session.user.language = newLanguage;
        
        try {
            // Update users.json with new language preference
            const usersPath = path.join(__dirname, 'users.json');
            const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
            const updatedUsers = users.users.map(user => 
                user.email === req.session.user.email 
                    ? { ...user, language: newLanguage }
                    : user
            );
            fs.writeFileSync(usersPath, JSON.stringify({ users: updatedUsers }, null, 2));
            
            await new Promise((resolve) => req.session.save(resolve));
            res.json({ success: true, language: newLanguage });
        } catch (error) {
            console.error('Error saving language:', error);
            res.status(500).json({ error: 'Failed to save language' });
        }
    } else {
        res.status(401).json({ error: 'Not authenticated' });
    }
});

// Logout endpoint
app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            res.status(500).json({ error: 'Could not log out' });
        } else {
            res.clearCookie('sessionId');
            res.sendStatus(200);
        }
    });
});

// Socket.IO connection handling
io.on('connection', (socket) => {

    console.log('A user connected:', socket.id);

    // Broadcast to everyone else that a new user connected
    socket.broadcast.emit('user status update', { status: 'online' });
    // Also notify the new user if others are online
    if (io.engine.clientsCount > 1) {
        socket.emit('user status update', { status: 'online' });
    }

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        socket.broadcast.emit('user status update', { status: 'offline' });
    });

    socket.on('check online status', () => {
        if (io.engine.clientsCount > 1) {  // If more than one user connected
            socket.emit('user status update', { status: 'online' });
        }
    });

    socket.userLanguage = 'EN'; // Default language

    socket.on('set language', (data) => {
        console.log('Setting socket language:', {
            socketId: socket.id,
            newLanguage: data.language,
            previousLanguage: socket.userLanguage
        });
        socket.userLanguage = data.language;
    });

    // Call events
    socket.on('call request', (data) => {
        console.log('Call request:', data);
        socket.broadcast.emit('call request', data);
    });

    socket.on('call accepted', (data) => {
        console.log('Call accepted:', data);
        socket.broadcast.emit('call accepted', data);
    });

    socket.on('call declined', (data) => {
        console.log('Call declined:', data);
        socket.broadcast.emit('call declined', data);
    });

    socket.on('end call', () => {
        console.log('Call ended by:', socket.id);
        socket.broadcast.emit('call ended');
    });

    // Chat message with translation
    socket.on('chat message', async (data) => {
        try {
            // Log current usage
            console.log('Monthly character count:', monthlyCharCount);
            console.log('Message characters:', data.message.length);
    
            for (let [clientId, clientSocket] of io.sockets.sockets) {
                if (clientId !== socket.id) {
                    const targetLang = clientSocket.userLanguage || 'EN';
                    
                    if (socket.userLanguage && socket.userLanguage !== targetLang) {
                        try {
                            // Update character count before translation
                            monthlyCharCount += data.message.length;
                            console.log(`Translation attempt: ${monthlyCharCount}/${MONTHLY_FREE_LIMIT} characters used this month`);
    
                            const [translation] = await translate.translate(data.message, targetLang);
                            
                            clientSocket.emit('chat message', {
                                message: data.message,
                                translation: translation,
                                userName: data.userName
                            });
                        } catch (error) {
                            console.error('Translation error:', error);
                            clientSocket.emit('chat message', {
                                message: data.message,
                                userName: data.userName,
                                error: 'Translation unavailable'
                            });
                        }
                    } else {
                        clientSocket.emit('chat message', {
                            message: data.message,
                            userName: data.userName
                        });
                    }
                }
            }
        } catch (error) {
            console.error('Message handling error:', error);
            socket.broadcast.emit('chat message', {
                message: data.message,
                userName: data.userName
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const port = process.env.PORT || 3000;

http.listen(port, () => {
    console.log(`Server running on port ${port}`);
});