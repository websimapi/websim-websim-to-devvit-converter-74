export const generatePackageJson = (slug, dependencies = {}, devDependencies = {}) => JSON.stringify({
  "name": slug,
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "devvit playtest",
    "build:client": "cd src/client && vite build",
    "build:server": "cd src/server && vite build",
    "build": "npm run build:server && npm run build:client",
    "setup": "node scripts/setup.js", 
    "register": "devvit upload",
    "upload": "devvit upload",
    "validate": "node scripts/validate.js"
  },
  "dependencies": {
    "@devvit/public-api": "latest",
    "@devvit/kit": "latest",
    "@devvit/web": "latest",
    "@devvit/redis": "latest",
    "@devvit/payments": "latest",
    "express": "^4.18.2",
    ...dependencies
  },
  "devDependencies": {
    "devvit": "latest",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "terser": "^5.19.0",
    "@vitejs/plugin-react": "^4.2.0",
    "@babel/core": "^7.23.0",
    "@babel/preset-react": "^7.23.0",
    ...devDependencies
  }
}, null, 2);

export const generateDevvitJson = (slug, entrypoints, enablePayments = true) => {
  const config = {
    "$schema": "https://developers.reddit.com/schema/config-file.v1.json",
    "name": slug,
    "post": {
      "dir": "dist/client",
      "entrypoints": entrypoints || {
        "default": {
          "entry": "index.html",
          "height": "tall",
          "inline": true
        }
      }
    },

    "server": {
      "entry": "index.cjs"
    },
    "permissions": {
      "redis": true,
      "realtime": true,
      "reddit": {
        "enable": true,
        "asUser": ["SUBMIT_POST", "SUBMIT_COMMENT"]
      }
    },
    "triggers": {
      "onAppInstall": "/internal/onInstall"
    },
    "menu": {
      "items": [
        {
          "label": "Add Game Post",
          "location": "subreddit",
          "forUserType": "moderator",
          "endpoint": "/internal/createPost"
        }
      ]
    }
  };

  if (enablePayments) {
    config.media = {
      "dir": "assets"
    };
    config.payments = {
      "productsFile": "products.json",
      "endpoints": {
        "fulfillOrder": "/internal/payments/fulfill",
        "refundOrder": "/internal/payments/refund"
      }
    };
  }

  return JSON.stringify(config, null, 2);
};

export const generateClientViteConfig = ({ hasReact = false, hasRemotion = false, inputs = {} } = {}) => `
import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

${hasReact ? "import react from '@vitejs/plugin-react';" : ""}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  mode: 'production',
  base: './',
  plugins: [
    ${hasReact ? `react({
      jsxRuntime: 'automatic', 
      jsxImportSource: 'react',
      include: "**/*.{jsx,tsx,js,ts}",
      babel: {
        babelrc: false,
        configFile: false,
        plugins: [],
        compact: true // ← ADD THIS: Ensures no eval in output
      }
    }),` : ''}
  ],
  resolve: {
    alias: {
      'react/jsx-dev-runtime': path.resolve(__dirname, './jsx-dev-proxy.js'),
      'react/jsx-runtime': 'react/jsx-runtime',
      'remotion': 'remotion',
      'websim': path.resolve(__dirname, './websim_package.js'),
      '@protobufjs/inquire': path.resolve(__dirname, './protobuf-inquire-stub.js'),
      'protobufjs/inquire': path.resolve(__dirname, './protobuf-inquire-stub.js')
    },
    extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    mainFields: ['browser', 'module', 'main'],
  },
  assetsInclude: ['**/*.mp3', '**/*.wav', '**/*.ogg', '**/*.glb', '**/*.gltf', '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif'],
  esbuild: {
    loader: 'jsx',
    include: /\.(js|jsx|ts|tsx)$/, // regex fix
    exclude: [],
    legalComments: 'none', 
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    target: 'es2020',
    minify: 'terser', // ← CHANGE FROM esbuild to terser for better CSP compliance
    terserOptions: {
      compress: {
        drop_console: false,
        pure_funcs: [],
        ecma: 2020,
        passes: 2
      },
      format: {
        comments: false,
        ecma: 2020
      },
      module: true,
      toplevel: true,
      safari10: true
    },
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      ${Object.keys(inputs).length > 0 ? `input: ${JSON.stringify(inputs)},` : ''}
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name][extname]",
        format: 'es', // ← ADD THIS: Force ES modules (no eval)
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/remotion') || id.includes('node_modules/@remotion')) return 'remotion';
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'react-vendor';
        }
      },
      external: [], 
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.platform": JSON.stringify("browser"),
    "process.env.REMOTION_ENV": JSON.stringify("production"),
    "__REACT_DEVTOOLS_GLOBAL_HOOK__": JSON.stringify({ isDisabled: true }),
    "process.env.REMOTION_DISABLE_STUDIO": JSON.stringify("true"),
    "global": "globalThis",
  },
  optimizeDeps: {
    include: [${hasReact ? "'react', 'react-dom', 'react/jsx-runtime'" : ""}, ${hasRemotion ? "'remotion', '@remotion/player'" : ""}],
    esbuildOptions: {
      target: 'es2020',
      legalComments: 'none' // ← ADD THIS
    }
  }
});
`;

export const tsConfig = JSON.stringify({
  "compilerOptions": {
    "target": "es2020",
    "module": "es2020",
    "moduleResolution": "node",
    "lib": ["es2020", "dom"],
    "jsx": "react",
    "jsxFactory": "Devvit.createElement",
    "jsxFragmentFactory": "Devvit.Fragment",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "noImplicitAny": false,
    "allowJs": true
  },
  "include": [
    "src"
  ]
}, null, 2);

export const generateServerViteConfig = () => `
import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

export default defineConfig({
  ssr: {
    noExternal: true,
  },
  build: {
    ssr: 'index.ts',
    outDir: '../../dist/server',
    target: 'node22',
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      external: [...builtinModules],
      output: {
        format: 'cjs',
        entryFileNames: 'index.cjs',
        inlineDynamicImports: true,
      },
      onwarn(warning, warn) {
        // Suppress "Use of eval" warning from protobufjs/inquire which is common in devvit/google protos
        if (warning.code === 'EVAL' && warning.id.includes('protobufjs')) return;
        warn(warning);
      },
    },
  },
});
`;

