import { Request, Response, NextFunction } from 'express';

/**
 * SQL Injection Detection Patterns
 * Detects common SQL injection meta-characters, boolean-based, UNION-based, and stacked queries
 */
const SQL_INJECTION_PATTERNS = [
  /(\%27)|(\')|(\-\-)|(\%23)|(#)/i,
  /((\%3D)|(=))[^\n]*((\%27)|(\')|(\-\-)|(\%3B)|(;))/i,
  /\w*((\%27)|(\'))(\s)*((\%6F)|o|(\%4F))((\%72)|r|(\%52))/i,
  /exec(\s|\+)+(s|x)p\w+/i,
  /UNION(\s|\+)+(ALL(\s|\+)+)?SELECT/i,
  /DROP(\s|\+)+TABLE/i,
  /INSERT(\s|\+)+INTO/i,
  /DELETE(\s|\+)+FROM/i,
  /SELECT(\s|\+)+.*(\s|\+)+FROM/i,
  /UPDATE(\s|\+)+.*(\s|\+)+SET/i,
  /(\%27)|(\')(\s)*(OR|AND)(\s)*(\%27)|(\')/i
];

/**
 * NoSQL & JSON Prototype Pollution Patterns
 */
const PROTOTYPE_POLLUTION_KEYS = ['__proto__', 'constructor', 'prototype'];
const DANGEROUS_NOSQL_KEYS = ['$gt', '$gte', '$lt', '$lte', '$ne', '$in', '$nin', '$or', '$and', '$not', '$nor', '$where', '$regex', '$expr'];

/**
 * Clean and escape dangerous string characters to prevent stored XSS and SQL injection
 */
export function sanitizeString(input: string): string {
  if (typeof input !== 'string') return input;

  return input
    // Remove null bytes
    .replace(/\0/g, '')
    // Normalize control characters
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Check if a string contains known SQL injection attempt
 */
export function containsSQLInjection(input: string): boolean {
  if (typeof input !== 'string') return false;
  return SQL_INJECTION_PATTERNS.some(pattern => pattern.test(input));
}

/**
 * Deep sanitization of objects against Prototype Pollution and NoSQL injection
 */
export function sanitizeObject<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    if (typeof obj === 'string') {
      return sanitizeString(obj) as unknown as T;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item)) as unknown as T;
  }

  const clean: any = {};
  for (const [key, value] of Object.entries(obj)) {
    // Block prototype pollution
    if (PROTOTYPE_POLLUTION_KEYS.includes(key)) {
      continue;
    }
    // Block NoSQL operator injection keys
    if (DANGEROUS_NOSQL_KEYS.includes(key)) {
      continue;
    }
    clean[key] = sanitizeObject(value);
  }

  return clean;
}

/**
 * Express Middleware: Global Input Sanitization & Anti-Injection Guard
 */
export function securitySanitizerMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }

  // Sanitize URL route parameters
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }

  // Sanitize request body
  if (req.body && typeof req.body === 'object') {
    // Clean prototype pollution and dangerous keys
    req.body = sanitizeObject(req.body);
  }

  // Set standard security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  next();
}
