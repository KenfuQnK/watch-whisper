import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Carga las variables de entorno del directorio actual.
  // El tercer parámetro '' le dice a Vite que cargue TODAS las variables, 
  // no solo las que empiezan por VITE_.
  const env = loadEnv(mode, (process as any).cwd(), '');

  return {
    plugins: [react()],
    define: {
      // Esto "inyecta" el valor de tu API_KEY de Vercel en el código del navegador
      // sustituyendo 'process.env.API_KEY' por el valor real.
      'process.env.API_KEY': JSON.stringify(env.API_KEY || process.env.API_KEY),
    },
  };
});