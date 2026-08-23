import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import { Server as SocketIOServer } from 'socket.io';

import { requireAuth } from './middleware/auth';
import { authRateLimiter, apiRateLimiter } from './middleware/rateLimiter';
import { uploadMedia } from './middleware/upload';
import { securitySanitizerMiddleware } from './security/sanitizer';
import { setupSocketHandlers } from './socket/socketHandler';

import * as authController from './controllers/authController';
import * as serverController from './controllers/serverController';
import * as dmController from './controllers/dmController';
import * as mediaController from './controllers/mediaController';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 4000;

// ============================================================
// CORS: Allow the Vercel frontend URL + local dev
// ============================================================
const ALLOWED_ORIGINS = [
  process.env.CLIENT_URL,         // e.g. https://aerocord.vercel.app
  'http://localhost:5173',         // local Vite dev
  'http://localhost:4173',         // local Vite preview
  'http://localhost:3000',
].filter(Boolean) as string[];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.) and whitelisted origins
    if (!origin || ALLOWED_ORIGINS.some(o => origin.startsWith(o))) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

// Security Middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // preflight

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Apply SQL/NoSQL Injection & Prototype Pollution Sanitizer
app.use(securitySanitizerMiddleware);

// Apply general API rate limiting
app.use('/api/', apiRateLimiter);

// ==========================================
// API ROUTES
// ==========================================

const router = express.Router();

// Auth Routes (with brute-force & SQL injection protection)
router.get('/auth/check', authController.checkAvailability);
router.post('/auth/register', authRateLimiter, authController.register);
router.post('/auth/login', authRateLimiter, authController.login);
router.post('/auth/2fa/verify', authRateLimiter, authController.verify2FALogin);
router.post('/auth/2fa/toggle', requireAuth, authController.toggleTwoFactor);
router.post('/auth/2fa/setup/google', requireAuth, authController.setup2FAGoogle);
router.post('/auth/2fa/confirm/google', requireAuth, authController.confirm2FAGoogle);
router.post('/auth/2fa/setup/file', requireAuth, authController.setup2FAFile);
router.post('/auth/2fa/confirm/file', requireAuth, authController.confirm2FAFile);
router.post('/auth/2fa/disable', requireAuth, authController.disable2FA);
router.post('/auth/change-password', requireAuth, authController.changePassword);
router.post('/auth/guest', authRateLimiter, authController.guestLogin);
router.post('/auth/logout', requireAuth, authController.logout);
router.post('/auth/send-verification', requireAuth, authController.sendVerificationCode);
router.post('/auth/upgrade-guest', requireAuth, authController.upgradeGuestAccount);
router.post('/admin/reset-db', authController.resetDatabase);
router.get('/auth/me', requireAuth, authController.getMe);
router.put('/auth/profile', requireAuth, authController.updateProfile);
router.get('/auth/friends', requireAuth, authController.getFriends);
router.post('/auth/friends/request', requireAuth, authController.sendFriendRequest);
router.post('/auth/friends/respond', requireAuth, authController.respondFriendRequest);
router.get('/auth/users/search', requireAuth, authController.searchUsers);

// Server Routes
router.get('/servers', requireAuth, serverController.getServers);
router.post('/servers', requireAuth, serverController.createServer);
router.put('/servers/:serverId', requireAuth, serverController.updateServer);
router.delete('/servers/:serverId', requireAuth, serverController.deleteServer);
router.post('/servers/join', requireAuth, serverController.joinServerByInvite);
router.get('/servers/:serverId', requireAuth, serverController.getServerDetails);
router.post('/servers/:serverId/channels', requireAuth, serverController.createChannel);
router.put('/servers/:serverId/channels/:channelId', requireAuth, serverController.updateChannel);
router.delete('/servers/:serverId/channels/:channelId', requireAuth, serverController.deleteChannel);
router.post('/servers/:serverId/categories', requireAuth, serverController.createCategory);

// Direct Messages & Channel Message Routes
router.get('/dm/conversations', requireAuth, dmController.getConversations);
router.post('/dm/create', requireAuth, dmController.createOrGetDM);
router.post('/dm/group', requireAuth, dmController.createGroupDM);
router.get('/channels/:channelId/messages', requireAuth, dmController.getChannelMessages);

// Media & Stickers Routes (files go to Supabase Storage)
router.post('/media/upload', requireAuth, uploadMedia.single('file'), mediaController.uploadAttachment);
router.get('/media/stickers', requireAuth, mediaController.getStickerPacks);
router.post('/media/stickers/custom', requireAuth, uploadMedia.single('file'), mediaController.createCustomSticker);

app.use('/api', router);

// Root health check
app.get('/', (_req: Request, res: Response) => {
  res.json({
    service: 'AeroCord Backend API',
    status: 'online',
    version: '2.0.0',
    database: 'Supabase PostgreSQL',
    storage: 'Supabase Storage',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'AeroCord Backend', timestamp: new Date().toISOString() });
});

// Global Error Handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server Error]', err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal Server Error' });
});

// Setup Socket.IO Server with CORS
const io = new SocketIOServer(server, {
  cors: {
    origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  maxHttpBufferSize: 1.5e7 // 15MB
});

setupSocketHandlers(io);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 AeroCord Backend running on port ${PORT}`);
  console.log(`📦 Database: Supabase PostgreSQL`);
  console.log(`🗄️  Storage: Supabase Storage`);
  console.log(`🌐 Allowed origins: ${ALLOWED_ORIGINS.join(', ') || '*'}`);
});
