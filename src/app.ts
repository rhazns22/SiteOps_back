import './config/env';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { apiLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/errorMiddleware';
import { authRouter } from './routes/authRoutes';
import { authKakaoRouter } from './routes/authKakaoRoutes';
import { invitationRouter } from './routes/invitationRoutes';
import { projectRouter } from './routes/projectRoutes';
import { requestRouter } from './routes/requestRoutes';
import { uploadRouter } from './routes/uploadRoutes';
import { dashboardRouter } from './routes/dashboardRoutes';
import { notificationRouter } from './routes/notificationRoutes';
import { healthRouter } from './routes/healthRoutes';
import { userRouter } from './routes/userRoutes';
import { clientRouter } from './routes/clientRoutes';
import { settingsRouter } from './routes/settingsRoutes';

export const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);
app.use(apiLimiter);
app.use(express.json({ limit: '1mb' }));

// Cache-Control: Prevent browser / CDN proxy caching of API responses
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use('/api/v1/health', healthRouter);
app.use('/api/v1/auth/kakao', authKakaoRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/invitations', invitationRouter);
app.use('/api/v1/projects', projectRouter);
app.use('/api/v1/requests', requestRouter);
app.use('/api/v1/uploads', uploadRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/notifications', notificationRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/clients', clientRouter);
app.use('/api/v1/settings', settingsRouter);

app.use(notFoundHandler);
app.use(errorHandler);
