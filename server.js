require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const { Translate } = require('@google-cloud/translate').v2;

const port = process.env.PORT || 3000;

// Production security headers
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Session configuration with secure settings
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false
}));

// Parse JSON bodies
app.use(express.json());

// Debug middleware to log all requests
app.use((req, res, next) => {
  logger.info('Request received:', { 
      path: req.path, 
      method: req.method,
      isAuthenticated: !!req.session.user
  });
  next();
});

// Middleware to check if user is logged in
const requireLogin = (req, res, next) => {
  if (req.session.user) {
      next();
  } else {
      if (req.path === '/login' || req.path === '/login.html' || req.path.startsWith('/css/')) {
          next();
      } else {
          logger.info('Unauthorized access attempt:', { path: req.path });
          res.redirect('/login.html');
      }
  }
};

app.use(requireLogin);

// Serve static files with login protection
app.use((req, res, next) => {
    if (req.path === '/login.html' || req.path === '/styles.css') {
        next();
    } else {
        requireLogin(req, res, next);
    }
});

app.use(express.static('public'));

// Routes
app.get('/', (req, res) => {
    if (req.session.user) {
        res.redirect('/index.html');
    } else {
        res.redirect('/login.html');
    }
});

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

// Login endpoint
app.post('/login', (req, res) => {
  logger.info('Login attempt received:', { body: req.body });
  
  const { email } = req.body;
  
  try {
      // Read users from JSON file
      const usersData = fs.readFileSync('users.json', 'utf8');
      const users = JSON.parse(usersData);
      
      // Check if email exists in users list
      const user = users.users.find(user => user.email === email);
      logger.info('Login check result:', { 
          attemptedEmail: email, 
          userFound: !!user 
      });
      
      if (user) {
          req.session.user = { 
              email: user.email,
              name: user.name 
          };
          logger.info('Login successful:', { user });
          res.status(200).json({ name: user.name });
      } else {
          logger.info('Login failed - user not found:', { attemptedEmail: email });
          res.status(401).json({ error: 'Invalid email address' });
      }
  } catch (error) {
      logger.error('Error during login:', { error: error.message });
      res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout endpoint
app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            res.status(500).json({ error: 'Could not log out' });
        } else {
            res.sendStatus(200);
        }
    });
});

// Initialize Google Translate
const translate = new Translate({
  key: process.env.GOOGLE_TRANSLATE_API_KEY
});

// Add this function to handle translation
async function translateText(text, targetLanguage) {
  try {
      const [translation] = await translate.translate(text, targetLanguage);
      return translation;
  } catch (error) {
      console.error('Translation error:', error);
      return null;
  }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
  let userLanguage = 'EN';

  socket.on('set language', (lang) => {
      userLanguage = lang;
      socket.userLanguage = lang;
      logger.info('Language set:', { socketId: socket.id, language: lang });
  });

  socket.on('chat message', async (data) => {
      try {
          // Detect the source language
          const [detection] = await translate.detect(data.message);
          const sourceLanguage = detection.language.toUpperCase();

          // Broadcast to all other clients
          for (let [id, otherSocket] of io.sockets.sockets) {
              if (id !== socket.id) {
                  const targetLang = otherSocket.userLanguage || 'EN';
                  
                  // Only translate if languages are different
                  if (sourceLanguage !== targetLang) {
                      const translation = await translateText(data.message, targetLang);
                      otherSocket.emit('chat message', {
                          message: data.message,
                          translation: translation,
                          userName: data.userName,
                          sourceLanguage: sourceLanguage
                      });
                  } else {
                      otherSocket.emit('chat message', {
                          message: data.message,
                          userName: data.userName,
                          sourceLanguage: sourceLanguage
                      });
                  }
              }
          }
      } catch (error) {
          logger.error('Translation error:', error);
          socket.broadcast.emit('chat message', {
              message: data.message,
              userName: data.userName
          });
      }
  });

    socket.on('photo', (photoData) => {
        socket.broadcast.emit('photo', photoData);
    });

    socket.on('set language', (lang) => {
        socket.userLanguage = lang;
        console.log(`User language set to: ${lang}`);
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
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
});

// Verify files on startup
try {
  const usersFile = fs.readFileSync('users.json', 'utf8');
  const users = JSON.parse(usersFile);
  logger.info('Users file loaded successfully', { 
      userCount: users.users.length,
      users: users.users 
  });
} catch (error) {
  logger.error('Error loading users file:', { error: error.message });
}

http.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});