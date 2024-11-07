require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { createClient } = require('redis');
const RedisStore = require('connect-redis').default;
const path = require('path');
const fs = require('fs');

const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
// Google Translate
const { Translate } = require('@google-cloud/translate').v2;
const translate = new Translate({key: process.env.GOOGLE_TRANSLATE_API_KEY});

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
            // Set session data with explicit language
            req.session.user = {
                email: user.email,
                name: user.name,
                language: req.session?.user?.language || 'EN' // Preserve existing language or default to EN
            };

            console.log('Setting user session:', req.session.user);

            await new Promise((resolve, reject) => {
                req.session.save((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            console.log('Session saved with language:', req.session.user.language);
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
    console.log('Auth check:', {
        sessionID: req.sessionID,
        session: req.session,
        user: req.session?.user
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
    console.log('Set language request:', {
        body: req.body,
        currentSession: req.session
    });
    
    if (req.session?.user) {
        const newLanguage = req.body.language;
        req.session.user.language = newLanguage;
        
        // Save session explicitly
        req.session.save((err) => {
            if (err) {
                console.error('Error saving language:', err);
                res.status(500).json({ error: 'Failed to save language' });
            } else {
                console.log('Language saved:', {
                    user: req.session.user,
                    newLanguage: newLanguage
                });
                res.json({ success: true, language: newLanguage });
            }
        });
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

// Socket.IO handling
io.on('connection', (socket) => {
    console.log('A user connected');

    // In server.js, modify the chat message socket event
socket.on('chat message', async (data) => {
    try {
        // Detect language
        const [detection] = await translate.detect(data.message);
        const sourceLanguage = detection.language.toUpperCase();

        // Send to all clients except sender
        for (let [id, clientSocket] of io.sockets.sockets) {
            if (id !== socket.id) {
                const targetLang = clientSocket.userLanguage || 'EN';
                
                if (sourceLanguage !== targetLang) {
                    try {
                        const [translation] = await translate.translate(
                            data.message, 
                            targetLang
                        );
                        clientSocket.emit('chat message', {
                            message: data.message,
                            translation: translation,
                            userName: data.userName
                        });
                    } catch (error) {
                        console.error('Translation error:', error);
                        clientSocket.emit('chat message', {
                            message: data.message,
                            userName: data.userName
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

    socket.on('photo', (photoData) => {
        socket.broadcast.emit('photo', photoData);
    });

    socket.on('call request', (data) => {
        socket.broadcast.emit('call request', data);
    });

    socket.on('call accepted', (data) => {
        socket.broadcast.emit('call accepted', data);
    });

    socket.on('call declined', (data) => {
        socket.broadcast.emit('call declined', data);
    });

    socket.on('end call', () => {
        socket.broadcast.emit('call ended');
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
    });
});

const port = process.env.PORT || 3000;

http.listen(port, () => {
    console.log(`Server running on port ${port}`);
});