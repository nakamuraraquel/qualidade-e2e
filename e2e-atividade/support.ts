import {
  test as base,
  expect,
  type Locator,
  type Page,
  type Request,
  type Response,
} from "@playwright/test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export interface Student {
  ra: number;
  name: string;
}

/**
 * Dados iniciais conhecidos do banco E2E. São os mesmos três alunos de
 * database/seed.sql, mas declarados aqui para que os testes conheçam
 * exatamente o estado de partida e não dependam do seed do laboratório.
 */
export const SEED_STUDENTS: readonly Student[] = [
  { ra: 258001, name: "Ana Clara Silva" },
  { ra: 258002, name: "Bruno Henrique Santos" },
  { ra: 258003, name: "Camila Oliveira Souza" },
];

export const MESSAGES = {
  success: "Aluno cadastrado com sucesso.",
  emptyList: "Nenhum aluno cadastrado.",
  duplicateRa:
    "Não foi possível cadastrar o aluno. Já existe um estudante com este RA.",
  shortName: "Informe um nome com pelo menos 3 caracteres.",
} as const;

// ---------------------------------------------------------------------------
// Banco de dados E2E (exclusivo do projeto Docker aula4-atividade-e2e)
// ---------------------------------------------------------------------------

const COMPOSE_ARGS = [
  "compose",
  "-f",
  "compose.atividade.e2e.yml",
  "-p",
  "aula4-atividade-e2e",
];

/** Executa SQL no banco atividade_e2e por meio do psql do contêiner. */
export function runSql(sql: string): string {
  const result = spawnSync(
    "docker",
    [
      ...COMPOSE_ARGS,
      "exec",
      "-T",
      "database",
      "psql",
      "-U",
      "postgres",
      "-d",
      "atividade_e2e",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-t",
      "-A",
    ],
    { cwd: resolve(__dirname, ".."), encoding: "utf8", input: sql },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Falha ao executar SQL no banco E2E: ${result.error?.message ?? result.stderr}`,
    );
  }
  return result.stdout.trim();
}

const sqlText = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * Restaura o banco para um estado conhecido: remove todos os registros e
 * insere somente os alunos informados. Também desfaz a simulação de
 * indisponibilidade usada nos cenários extras de falha da API.
 */
export function resetDatabase(students: readonly Student[]) {
  const insert =
    students.length === 0
      ? ""
      : "INSERT INTO students (ra, name) VALUES " +
        students.map((s) => `(${s.ra}, ${sqlText(s.name)})`).join(", ") +
        ";";
  runSql(`
    DO $$ BEGIN
      IF to_regclass('public.students_indisponivel') IS NOT NULL THEN
        ALTER TABLE students_indisponivel RENAME TO students;
      END IF;
    END $$;
    BEGIN;
    TRUNCATE enrollments, courses, students RESTART IDENTITY CASCADE;
    ${insert}
    COMMIT;
  `);
}

/**
 * Torna a tabela de alunos inacessível para a API real (que passa a responder
 * HTTP 500). Usado apenas nos cenários extras de falha; a próxima restauração
 * do banco desfaz a alteração.
 */
export function makeStudentsTableUnavailable() {
  runSql("ALTER TABLE students RENAME TO students_indisponivel;");
}

// ---------------------------------------------------------------------------
// Page object da interface "Cadastro de alunos"
// ---------------------------------------------------------------------------

const isStudentsApi = (response: Response, method: "GET" | "POST") =>
  new URL(response.url()).pathname === "/api/students" &&
  response.request().method() === method;

export const sortByRa = (students: readonly Student[]) =>
  [...students].sort((a, b) => a.ra - b.ra);

export class StudentsPage {
  readonly form: Locator;
  readonly raInput: Locator;
  readonly nameInput: Locator;
  readonly submitButton: Locator;
  readonly formMessage: Locator;
  readonly listSection: Locator;
  readonly listMessage: Locator;
  readonly table: Locator;
  readonly rows: Locator;

  constructor(readonly page: Page) {
    // Seletores acessíveis (label, papel e nome) e data-testid disponíveis.
    this.form = page.getByTestId("student-form");
    this.raInput = page.getByLabel("RA", { exact: true });
    this.nameInput = page.getByLabel("Nome", { exact: true });
    this.submitButton = page.getByRole("button", { name: "Cadastrar aluno" });
    this.formMessage = page.getByTestId("form-message");
    this.listSection = page.getByRole("region", { name: "Alunos cadastrados" });
    this.listMessage = page.getByTestId("list-message");
    this.table = page.getByTestId("students-table");
    this.rows = page.getByTestId("student-row");
  }

  /** Promise da próxima resposta de GET /api/students (registre antes da ação). */
  waitForListResponse() {
    return this.page.waitForResponse((r) => isStudentsApi(r, "GET"));
  }

  /** Promise da próxima resposta de POST /api/students (registre antes da ação). */
  waitForCreateResponse() {
    return this.page.waitForResponse((r) => isStudentsApi(r, "POST"));
  }

  /** Aguarda a interface terminar de processar a listagem com sucesso. */
  async expectListLoaded() {
    await expect(this.listSection).toHaveAttribute("aria-busy", "false");
    await expect(this.listMessage).toHaveAttribute("data-state", "success");
  }

  /** Abre a página e aguarda a listagem inicial (resposta HTTP + tela). */
  async open() {
    const listResponse = this.waitForListResponse();
    await this.page.goto("/");
    const response = await listResponse;
    expect(response.status()).toBe(200);
    await this.expectListLoaded();
    await expect(this.submitButton).toBeEnabled();
    return response;
  }

  /** Recarrega a página e aguarda a nova listagem. */
  async reload() {
    const listResponse = this.waitForListResponse();
    await this.page.reload();
    const response = await listResponse;
    expect(response.status()).toBe(200);
    await this.expectListLoaded();
    return response;
  }

  async fillForm(ra: number | string, name: string) {
    await this.raInput.fill(String(ra));
    await this.nameInput.fill(name);
  }

  /**
   * Cadastro bem-sucedido pela interface: preenche, clica e aguarda o POST
   * (201) e a nova consulta da lista disparada pela própria página.
   */
  async register(student: Student) {
    await this.fillForm(student.ra, student.name);
    const createResponse = this.waitForCreateResponse();
    const listResponse = this.waitForListResponse();
    await this.submitButton.click();
    const created = await createResponse;
    expect(created.status()).toBe(201);
    const list = await listResponse;
    expect(list.status()).toBe(200);
    await expect(this.formMessage).toHaveText(MESSAGES.success);
    await expect(this.formMessage).toHaveAttribute("data-state", "success");
    await this.expectListLoaded();
    return { created, list };
  }

  /** Lê RA e nome de cada linha exibida na tabela, na ordem da tela. */
  async readTable(): Promise<Student[]> {
    const students: Student[] = [];
    for (const row of await this.rows.all()) {
      const [ra, name] = await row.getByRole("cell").allInnerTexts();
      students.push({ ra: Number(ra), name });
    }
    return students;
  }

  /**
   * Verifica que a tabela exibe exatamente os alunos informados (sem
   * considerar a ordem). Primeiro aguarda a quantidade de linhas com
   * repetição automática; depois compara o conteúdo de cada célula.
   */
  async expectTableToContainExactly(students: readonly Student[]) {
    await expect(this.rows).toHaveCount(students.length);
    expect(sortByRa(await this.readTable())).toEqual(sortByRa(students));
  }

  /** Verifica a tabela linha a linha, na mesma ordem recebida da API. */
  async expectTableInOrder(students: readonly Student[]) {
    await expect(this.rows).toHaveCount(students.length);
    for (const [index, student] of students.entries()) {
      await expect(this.rows.nth(index).getByRole("cell")).toHaveText([
        String(student.ra),
        student.name,
      ]);
    }
  }

  /** Linha da tabela identificada pelo seu nome acessível ("RA Nome"). */
  row(student: Student) {
    return this.page.getByRole("row", {
      name: `${student.ra} ${student.name}`,
      exact: true,
    });
  }

  /** Estado de validação nativa (Constraint Validation API) de um campo. */
  validity(field: Locator) {
    return field.evaluate((element: HTMLInputElement) => ({
      valid: element.validity.valid,
      valueMissing: element.validity.valueMissing,
      rangeUnderflow: element.validity.rangeUnderflow,
      rangeOverflow: element.validity.rangeOverflow,
      stepMismatch: element.validity.stepMismatch,
      badInput: element.validity.badInput,
      tooShort: element.validity.tooShort,
      customError: element.validity.customError,
      message: element.validationMessage,
    }));
  }

  /**
   * Registra as requisições POST /api/students feitas pela página. Usado para
   * demonstrar que a validação local impediu o envio.
   */
  trackCreateRequests() {
    const requests: Request[] = [];
    this.page.on("request", (request) => {
      if (
        new URL(request.url()).pathname === "/api/students" &&
        request.method() === "POST"
      ) {
        requests.push(request);
      }
    });
    return requests;
  }

  /**
   * Marca o documento atual. Se a página for recarregada, a marca é perdida;
   * assim é possível provar que a lista foi atualizada sem recarregar.
   */
  async markDocument() {
    const marker = `doc-${Date.now()}-${Math.random()}`;
    await this.page.evaluate((value) => {
      (window as unknown as { __e2eMarker?: string }).__e2eMarker = value;
    }, marker);
    return marker;
  }

  async documentMarker() {
    return this.page.evaluate(
      () => (window as unknown as { __e2eMarker?: string }).__e2eMarker,
    );
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Fixtures = {
  /** Alunos presentes no banco antes do teste. Altere com test.use(). */
  initialStudents: readonly Student[];
  /** Restaura o banco antes de cada teste (automático). */
  resetDb: void;
  studentsPage: StudentsPage;
};

export const test = base.extend<Fixtures>({
  initialStudents: [SEED_STUDENTS, { option: true }],
  resetDb: [
    async ({ initialStudents }, use) => {
      resetDatabase(initialStudents);
      await use();
    },
    { auto: true },
  ],
  studentsPage: async ({ page }, use) => {
    await use(new StudentsPage(page));
  },
});

export { expect };
