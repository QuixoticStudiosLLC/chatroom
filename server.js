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
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});
redisClient.connect().catch(console.error);

// Session setup with Redis
const sessionMiddleware = session({
    store: new RedisStore({ 
        client: redisClient,
        prefix: "session:",
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    },
    name: 'sessionId' // Custom name for clarity
});

app.use((req, res, next) => {
    console.log('Session status:', {
        hasSession: !!req.session,
        hasUser: !!req.session?.user,
        url: req.url
    });
    next();
});

app.use(sessionMiddleware);
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

// Check auth status
app.get('/check-auth', (req, res) => {
    if (req.session.user) {
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
app.post('/login', (req, res) => {
    const { email } = req.body;
    console.log('Login attempt for email:', email); // Add logging
    
    try {
        // Add absolute path to users.json
        const usersPath = path.join(__dirname, 'users.json');
        console.log('Reading users from:', usersPath); // Add logging
        
        const usersData = fs.readFileSync(usersPath, 'utf8');
        console.log('Users data:', usersData); // Add logging
        
        const users = JSON.parse(usersData);
        
        // Check if email exists in users list
        const userExists = users.users.some(user => user.email === email);
        console.log('User exists:', userExists); // Add logging
        
        if (userExists) {
            req.session.user = { email };
            res.sendStatus(200);
        } else {
            console.log('Invalid email:', email); // Add logging
            res.sendStatus(401);
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
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