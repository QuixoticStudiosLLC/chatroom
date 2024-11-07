const path = require('path');
const fs = require('fs');
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { createClient } = require('redis');
const RedisStore = require('connect-redis').default;

const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Redis setup
const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    legacyMode: false
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));
// Add this to test Redis connection
redisClient.on('connect', () => {
    console.log('Connected to Redis');
    // Test Redis functionality
    redisClient.set('test', 'working').then(() => {
        console.log('Redis write test successful');
    });
});

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

// Session setup with Redis
const RedisStore = require('connect-redis').default;

const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
        tls: false,
        rejectUnauthorized: false
    }
});

redisClient.connect().catch(console.error);

app.use(sessionMiddleware);

// Session Middleware
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

app.use(express.json());
app.use(express.static('public'));

// Middleware to check if user is logged in
const requireLogin = (req, res, next) => {
    if (req.session.user) {
        next();
    } else {
        if (req.accepts('html')) {
            res.redirect('/login.html');
        } else {
            res.status(401).json({ error: 'Unauthorized' });
        }
    }
};

// Routes
app.get('/', (req, res) => {
    console.log('Root route accessed, session:', req.session);
    if (req.session && req.session.user) {
        res.redirect('/index.html');
    } else {
        res.redirect('/login.html');
    }
});

// Protect all routes except login
app.use((req, res, next) => {
    console.log('Protection middleware:', {
        path: req.path,
        hasSession: !!req.session,
        hasUser: !!req.session?.user
    });
    
    if (req.path === '/login.html' || 
        req.path === '/styles.css' || 
        req.path === '/login' ||
        req.path === '/check-auth') {
        return next();
    }
    
    if (req.session && req.session.user) {
        return next();
    }
    
    console.log('Redirecting to login');
    res.redirect('/login.html');
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

// Protect main app page
app.get('/index.html', requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
            // Set session data
            req.session.user = {
                email: user.email,
                name: user.name
            };

            // Wait for session to be saved
            await new Promise((resolve, reject) => {
                req.session.save((err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // Verify session was saved
            const sessionData = await redisClient.get(`sess:${req.sessionID}`);
            console.log('Saved session data:', sessionData);

            res.sendStatus(200);
        } else {
            res.sendStatus(401);
        }
    } catch (error) {
        console.error('Login error:', error);
        res.sendStatus(500);
    }
});

// Logout endpoint
app.post('/logout', (req, res) => {
    console.log('Logout requested');
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            res.status(500).json({ error: 'Could not log out' });
        } else {
            console.log('Session destroyed successfully');
            // Clear the session cookie
            res.clearCookie('connect.sid');
            res.sendStatus(200);
        }
    });
});

// Check-auth endpoint
app.get('/check-auth', (req, res) => {
    console.log('Check auth request received');
    console.log('Session:', req.session);
    console.log('Session user:', req.session?.user);
    
    if (req.session && req.session.user) {
        console.log('User is authenticated:', req.session.user);
        res.json({ 
            authenticated: true, 
            user: req.session.user 
        });
    } else {
        console.log('User is not authenticated');
        res.json({ authenticated: false });
    }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('A user connected');

    let userLanguage = 'EN';

    socket.on('set language', (lang) => {
        userLanguage = lang;
        socket.userLanguage = lang;
        console.log(`Language set: ${lang} for socket ${socket.id}`);
    });

    socket.on('chat message', (data) => {
        socket.broadcast.emit('chat message', data);
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