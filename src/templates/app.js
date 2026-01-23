import { dbHelpers } from './server/db.js';
import { coreRoutes } from './server/routes/core.js';
import { paymentRoutes } from './server/routes/payments.js';
import { commentRoutes } from './server/routes/comments.js';
import { assetRoutes } from './server/routes/assets.js';
import { internalRoutes } from './server/routes/internal.js';

export const getMainTs = (title) => {
    const safeTitle = title.replace(/'/g, "\\'");
    return `
import express from 'express';
import { Devvit } from '@devvit/public-api';
import { 
    createServer, 
    context, 
    getServerPort, 
    redis, 
    reddit,
    realtime,
    payments
} from '@devvit/web/server';
// Enable Realtime & Reddit API
Devvit.configure({
    redditAPI: true,
    realtime: true,
    http: true
});

const app = express();

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.text({ limit: '10mb' }));

const router = express.Router();

// 1. Database & Helper Functions
${dbHelpers}

// 2. Core Routes (Project, User, Storage)
${coreRoutes}

// 3. Payment Routes (Tips, Supporters)
${paymentRoutes}

// 4. Comment Routes
${commentRoutes}

// 5. Asset Routes (Avatars, JSON)
${assetRoutes}

// 6. Internal Routes (Triggers, Realtime)
${internalRoutes(safeTitle)}

app.use(router);

const port = getServerPort();
const server = createServer(app);

server.on('error', (err) => console.error(\`server error; \${err.stack}\`));
server.listen(port, () => console.log(\`Server listening on \${port}\`));
`;
};

