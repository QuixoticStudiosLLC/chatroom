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