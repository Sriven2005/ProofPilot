import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { sqlEvaluatorPlugin } from './src/server/sqlEvaluatorPlugin.ts'
import { createGeminiTransport } from './src/server/geminiTransport.ts'

// https://vite.dev/config/
export default defineConfig(({mode}) => {
  // Read only on the server and pass only to the server middleware; never define these for the client bundle.
  const localEnv=loadEnv(mode,process.cwd(),'')
  const shadowTransport=createGeminiTransport({apiKey:localEnv.GEMINI_API_KEY,model:localEnv.GEMINI_MODEL})
  const shadowDisabled=localEnv.PROOFPILOT_DISABLE_GEMINI_SHADOW==='true'
  return {
    plugins: [react(), sqlEvaluatorPlugin(shadowDisabled?{}:{shadowTransport})],
  }
})
