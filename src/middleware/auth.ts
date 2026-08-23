import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../config/database';
import { User } from '../types';

export const JWT_SECRET = process.env.JWT_SECRET || 'aerocord-super-secure-jwt-key-2026-xyz-987';

export interface AuthenticatedRequest extends Request {
  user?: User;
}

export const generateToken = (user: User): string => {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
};

export const verifyJWTToken = (token: string): { id: string; username: string; email: string } | null => {
  try {
    return jwt.verify(token, JWT_SECRET) as { id: string; username: string; email: string };
  } catch {
    return null;
  }
};

/**
 * Async requireAuth middleware - awaits db.getUserById since DB is now async (Supabase).
 */
export const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized. No token provided.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const decoded = verifyJWTToken(token);

  if (!decoded) {
    res.status(401).json({ error: 'Invalid or expired authentication token.' });
    return;
  }

  const user = await db.getUserById(decoded.id);
  if (!user) {
    res.status(401).json({ error: 'User not found or deleted.' });
    return;
  }

  req.user = user;
  next();
};
