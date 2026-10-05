import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({base:'./',plugins:[react()],build:{assetsInlineLimit:100000000},server:{proxy:{'/upload':'http://localhost:3000','/ask':'http://localhost:3000'}}});
