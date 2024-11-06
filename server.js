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
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
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
    if (req.session.user) {
        res.redirect('/index.html');
    } else {
        res.redirect('/login.html');
    }
});

// Protect main app page
app.get('/index.html', requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login endpoint
app.post('/login', (req, res) => {
    const { email } = req.body;
    try {
        // Read users from JSON file
        const users = JSON.parse(fs.readFileSync('users.json', 'utf8'));
        
        // Check if email exists in users list
        const userExists = users.users.some(user => user.email === email);
        
        if (userExists) {
            req.session.user = { email };
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
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            res.status(500).json({ error: 'Could not log out' });
        } else {
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