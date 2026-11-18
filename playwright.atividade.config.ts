import { defineConfig, devices } from '@playwright/test';

/**
 * Configuração da suíte E2E da Atividade 2 (interface "Cadastro de alunos").
 *
 * É separada de playwright.config.ts, que continua apontando para o
 * Laboratório REST (porta 18080). Esta aponta para o frontend da pasta
 * atividade/, publicado pelo compose.atividade.e2e.yml na porta 18081.
 */
export default defineConfig({
  testDir: './e2e-atividade',
  // Todos os testes compartilham o mesmo banco E2E e o restauram antes de
  // cada cenário; por isso a execução é sequencial, com um único worker.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  outputDir: 'test-results-atividade',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report-atividade' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:18081',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
