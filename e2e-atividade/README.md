# Atividade 2 – Testes End-to-End do cadastro de alunos

Suíte E2E com **Playwright Test + TypeScript** para a interface da pasta
[`atividade/`](../atividade/README.md), executada contra a **interface, a API
Express e o PostgreSQL reais**, em um **banco exclusivo e descartável**.

```text
Playwright → Chromium → atividade/ (Nginx) → API Express → PostgreSQL (atividade_e2e)
```

## Como executar

Requisitos:

- Node.js 24 e npm.
- Docker em execução (contêineres Linux), com Docker Compose que suporte `up --wait`.
- Porta local `18081` livre.

Na **raiz do projeto**:

```powershell
npm ci
npx playwright install chromium
npm run test:atividade
```

Não é preciso subir nada manualmente. O comando `npm run test:atividade`
(script [`run.cjs`](run.cjs)):

1. Remove contêineres remanescentes do projeto Docker `aula4-atividade-e2e`.
2. Constrói e inicia banco, API e frontend da atividade com
   [`compose.atividade.e2e.yml`](../compose.atividade.e2e.yml) e aguarda os healthchecks.
3. Executa os testes no Chromium com
   [`playwright.atividade.config.ts`](../playwright.atividade.config.ts).
4. Salva os logs em `e2e-artifacts/compose-atividade.log` e encerra os
   contêineres, inclusive quando algum teste falha.

Resultado esperado: **`32 passed`** (19 testes dos cenários obrigatórios +
13 complementares). A primeira execução demora mais por causa da construção das
imagens e do download do navegador.

### Comandos úteis

| Comando | Finalidade |
| --- | --- |
| `npm run test:atividade` | Sobe o ambiente isolado, executa a suíte e encerra os contêineres. |
| `npm run test:atividade -- --headed` | Executa com a janela do navegador visível. |
| `npm run test:atividade -- --grep "RA duplicado"` | Executa só os testes cujo título corresponde ao filtro. |
| `npm run test:atividade -- --repeat-each=3` | Repete cada teste 3 vezes (verifica estabilidade e independência). |
| `npm run test:atividade:list` | Lista os testes sem iniciar o Docker. |
| `npm run test:atividade:typecheck` | Verifica os tipos dos testes e da configuração. |
| `npm run test:atividade:report` | Abre o relatório HTML da última execução. |

Se o processo for interrompido à força e os contêineres ficarem ativos:

```powershell
docker compose -f compose.atividade.e2e.yml -p aula4-atividade-e2e down --remove-orphans
```

## Ambiente e isolamento

| Item | Demonstração (`compose.yml`) | Laboratório E2E (`compose.e2e.yml`) | **Atividade E2E (`compose.atividade.e2e.yml`)** |
| --- | --- | --- | --- |
| Projeto Docker | `aula4` | `aula4-e2e` | **`aula4-atividade-e2e`** |
| Banco | `postgres` (volume persistente) | `aula4_e2e` (tmpfs) | **`atividade_e2e` (tmpfs)** |
| Interface | `front/` e `atividade/` | `front/` em `:18080` | **`atividade/` em `127.0.0.1:18081`** |
| Porta do PostgreSQL | publicada (`5433`) | não publicada | **não publicada** |
| Usa `.env` | sim | não | **não** |

- O banco dos testes é exclusivo, fica em memória (`tmpfs`) e é descartado ao
  encerrar os contêineres. **Os dados da demonstração nunca são alterados.**
- Antes de **cada** teste, a fixture automática `resetDb`
  ([`support.ts`](support.ts)) executa `TRUNCATE ... RESTART IDENTITY CASCADE`
  e insere os dados iniciais conhecidos (`SEED_STUDENTS`):

  | RA | Nome |
  | --- | --- |
  | 258001 | Ana Clara Silva |
  | 258002 | Bruno Henrique Santos |
  | 258003 | Camila Oliveira Souza |

- O cenário **Lista vazia** usa `test.use({ initialStudents: [] })` para
  começar com o banco sem alunos.
- Como cada teste restaura o banco e abre a página por conta própria, **qualquer
  teste pode ser executado sozinho e em qualquer ordem**. A execução usa um
  worker, sem paralelismo e sem novas tentativas automáticas (`retries: 0`).

## Cobertura dos cenários obrigatórios

Arquivo: [`cadastro-alunos.spec.ts`](cadastro-alunos.spec.ts). Cada `describe`
tem o mesmo nome do cenário no enunciado.

| Cenário | Testes | Principais asserções |
| --- | --- | --- |
| **Listagem inicial** | 1 | `GET /api/students` = 200 com os 3 alunos do seed; tabela com cabeçalhos RA/Nome e as 3 linhas **na mesma ordem da resposta da API**; cada linha acessível por `getByRole('row')`; sem mensagem de lista vazia. |
| **Cadastro válido** | 1 | Corpo enviado pela página = `{ ra, name }` digitados; `POST` = 201 com o aluno; mensagem **"Aluno cadastrado com sucesso."** visível com `data-state="success"`; botão reabilitado. |
| **Atualização da lista** | 1 | Novo aluno ausente antes e visível depois; a página faz novo `GET` que contém o aluno; tabela = seed + novo; **marca no `window` preservada e nenhuma navegação** (prova que não houve recarga). |
| **Limpeza do formulário** | 1 | Campos preenchidos antes do envio; RA e Nome com valor `""` depois; foco volta ao RA. |
| **Persistência** | 1 | Após `page.reload()`, o novo `GET` traz o aluno do banco e a tabela = seed + novo. |
| **Campos obrigatórios** | 3 | RA e Nome vazios / só RA vazio / só Nome vazio: `validity.valueMissing`, mensagem de validação, valores preservados, **nenhum `POST` enviado**, nenhuma mensagem de cadastro e tabela inalterada — inclusive **após recarregar** (nada gravado no banco). |
| **RA inválido** | 4 | `-5` e `0` (`rangeUnderflow`), `1.5` (`stepMismatch`), `2147483648` (`rangeOverflow`): campo inválido, valores preservados, nenhum `POST`, tabela e banco inalterados. |
| **Nome inválido** | 4 | `"A"` e `"Jo"` (barrados pelo `minlength`); `"   Jo   "` e `"      "` (passam pelo `minlength`, mas são barrados pela página após o *trim*, com a mensagem **"Informe um nome com pelo menos 3 caracteres."**); RA válido; nenhum `POST`; banco inalterado. |
| **RA duplicado** | 1 | `POST` real = 409 com "Já existe um estudante com este RA."; mensagem de erro exibida com `data-state="error"`; **RA e Nome continuam preenchidos**; botão reabilitado; aluno original intacto, antes e depois de recarregar. |
| **Lista vazia** | 2 | Banco sem alunos: `GET` = `[]`, mensagem **"Nenhum aluno cadastrado."** e 0 linhas; após o primeiro cadastro, a mensagem some e a linha aparece. |

## Cenários complementares

Arquivo: [`complementares.spec.ts`](complementares.spec.ts). Também usam API e
banco reais, sem simular respostas.

| Grupo | O que demonstra |
| --- | --- |
| Recuperação após erro | Depois de um RA duplicado ou de um nome inválido, o usuário corrige o dado e conclui o cadastro na mesma página. |
| Limites válidos | RA `1` e `2147483647`, nome com exatamente 3 e com 100 caracteres são aceitos; `"   Ana   "` é enviado e gravado como `"Ana"`. |
| Validação de RA também na API | Removendo do campo, apenas no navegador do teste, as restrições `min`/`max`/`step`, os RAs inválidos chegam ao backend real, que responde 400, e a interface exibe a mensagem de erro (o código da aplicação não é alterado). |
| Falhas da API | A tabela `students` do banco E2E é renomeada para provocar um erro **real** (HTTP 500): a página informa a falha da listagem e a falha do cadastro, mantendo os campos preenchidos. A fixture desfaz a alteração antes do próximo teste. |

## Boas práticas adotadas

- **Ações pela interface**: os cadastros sempre preenchem os campos e clicam em
  "Cadastrar aluno"; não há chamadas diretas à API para cadastrar.
- **Sem mocks** nos cenários obrigatórios: nenhuma rota é interceptada; o
  Playwright apenas observa as respostas com `waitForResponse`.
- **Seletores acessíveis**: `getByLabel('RA')`, `getByLabel('Nome')`,
  `getByRole('button', { name: 'Cadastrar aluno' })`, `getByRole('row')`,
  `getByRole('region', { name: 'Alunos cadastrados' })` e os `data-testid`
  documentados (`form-message`, `list-message`, `students-table`, `student-row`...).
- **Sem pausas fixas** (`waitForTimeout` não é usado): a espera por respostas é
  registrada **antes** do clique e as asserções `expect(locator)` aguardam
  condições observáveis (`aria-busy="false"`, `data-state`, quantidade de linhas).
- **Conteúdo apresentado ao usuário**: além do status HTTP, os testes verificam
  textos das mensagens, valores dos campos e o conteúdo de cada célula da tabela.
- **Page object** (`StudentsPage` em [`support.ts`](support.ts)) concentra
  seletores e sincronização; os testes ficam focados no comportamento.

## Organização

| Arquivo | Responsabilidade |
| --- | --- |
| `compose.atividade.e2e.yml` | Banco, API e frontend da atividade, exclusivos dos testes. |
| `playwright.atividade.config.ts` | Configuração do Playwright para a atividade (`baseURL` `http://127.0.0.1:18081`). |
| `e2e-atividade/run.cjs` | Sobe o ambiente, executa os testes, salva logs e encerra. |
| `e2e-atividade/support.ts` | Restauração do banco, fixtures e page object `StudentsPage`. |
| `e2e-atividade/cadastro-alunos.spec.ts` | Cenários obrigatórios. |
| `e2e-atividade/complementares.spec.ts` | Cenários complementares. |
| `e2e-atividade/tsconfig.json` | Verificação de tipos. |

Saídas geradas (ignoradas pelo Git): `playwright-report-atividade/` (relatório
HTML), `test-results-atividade/` (capturas e traces de falhas) e
`e2e-artifacts/compose-atividade.log` (logs dos serviços). Para investigar uma
falha: `npx playwright show-trace "caminho/para/trace.zip"`.

A suíte original do Laboratório REST (`e2e/`, `playwright.config.ts`,
`compose.e2e.yml`, `npm run test:e2e`) foi mantida sem alterações.
