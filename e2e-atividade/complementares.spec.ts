/**
 * Cenários complementares (além dos obrigatórios).
 *
 * Também usam a interface, a API e o banco reais, sem simular respostas:
 * - recuperação após um erro;
 * - limites válidos das regras de RA e Nome;
 * - rejeição dos RAs inválidos pela própria API (defesa em profundidade);
 * - falhas reais da API, provocadas no banco E2E isolado.
 */
import {
  test,
  expect,
  makeStudentsTableUnavailable,
  MESSAGES,
  SEED_STUDENTS,
} from "./support";

test.describe("Recuperação após erro", () => {
  test("após RA duplicado, permite corrigir o RA e concluir o cadastro", async ({
    studentsPage: app,
  }) => {
    await app.open();
    const name = "Aluno Persistente";

    await app.fillForm(SEED_STUDENTS[0].ra, name);
    const conflict = app.waitForCreateResponse();
    await app.submitButton.click();
    expect((await conflict).status()).toBe(409);
    await expect(app.formMessage).toHaveText(MESSAGES.duplicateRa);

    // Corrige apenas o RA; o nome continua preenchido desde a tentativa anterior.
    await expect(app.nameInput).toHaveValue(name);
    const student = { ra: 900020, name };
    await app.raInput.fill(String(student.ra));
    await app.register(student);

    await expect(app.raInput).toHaveValue("");
    await expect(app.nameInput).toHaveValue("");
    await app.expectTableToContainExactly([...SEED_STUDENTS, student]);
  });

  test("após um nome inválido, permite corrigir e concluir o cadastro", async ({
    studentsPage: app,
  }) => {
    await app.open();
    const posts = app.trackCreateRequests();

    // "  Jo  " passa pelo minlength, mas a página o rejeita após remover espaços.
    await app.fillForm(900021, "  Jo  ");
    await app.submitButton.click();
    expect((await app.validity(app.nameInput)).message).toBe(MESSAGES.shortName);

    const student = { ra: 900021, name: "Joana" };
    await app.nameInput.fill(student.name);
    // Ao digitar, a mensagem personalizada é removida.
    expect((await app.validity(app.nameInput)).valid).toBe(true);
    await app.register(student);

    expect(posts).toHaveLength(1);
    await app.expectTableToContainExactly([...SEED_STUDENTS, student]);
  });
});

test.describe("Limites válidos", () => {
  const cases = [
    { title: "RA mínimo (1)", typed: { ra: 1, name: "Aluno RA Um" } },
    {
      title: "RA máximo (2147483647)",
      typed: { ra: 2147483647, name: "Aluno RA Maximo" },
    },
    { title: "nome com exatamente 3 caracteres", typed: { ra: 900030, name: "Ana" } },
    {
      title: "nome com 100 caracteres",
      typed: { ra: 900031, name: "N".repeat(100) },
    },
  ];

  for (const { title, typed } of cases) {
    test(`aceita ${title}`, async ({ studentsPage: app }) => {
      await app.open();
      const { created } = await app.register(typed);
      expect(await created.json()).toEqual(typed);
      await app.expectTableToContainExactly([...SEED_STUDENTS, typed]);
    });
  }

  test("desconsidera espaços nas extremidades do nome ao cadastrar", async ({
    studentsPage: app,
  }) => {
    await app.open();
    const typed = { ra: 900032, name: "   Ana   " };
    const stored = { ra: 900032, name: "Ana" };

    const { created } = await app.register(typed);

    expect(created.request().postDataJSON()).toEqual(stored);
    await expect(app.row(stored)).toBeVisible();
    await app.reload();
    await app.expectTableToContainExactly([...SEED_STUDENTS, stored]);
  });
});

test.describe("Validação de RA também na API", () => {
  // Remove do campo apenas as restrições HTML (min, max, step) dentro do
  // navegador do teste, para que o valor chegue ao backend real. O código da
  // aplicação não é alterado: o objetivo é mostrar que a API também rejeita.
  for (const ra of ["-5", "0", "1.5", "2147483648"]) {
    test(`API rejeita RA ${ra} e a interface exibe o erro`, async ({
      studentsPage: app,
    }) => {
      await app.open();
      await app.raInput.evaluate((input) => {
        input.removeAttribute("min");
        input.removeAttribute("max");
        input.setAttribute("step", "any");
      });

      await app.fillForm(ra, "Nome Valido");
      const createResponse = app.waitForCreateResponse();
      await app.submitButton.click();
      const response = await createResponse;

      expect(response.status()).toBe(400);
      await expect(app.formMessage).toHaveText(
        "Não foi possível cadastrar o aluno. RA deve ser um inteiro positivo de até 2147483647.",
      );
      await expect(app.formMessage).toHaveAttribute("data-state", "error");
      await expect(app.raInput).toHaveValue(ra);
      await expect(app.submitButton).toBeEnabled();
      await app.reload();
      await app.expectTableToContainExactly(SEED_STUDENTS);
    });
  }
});

test.describe("Falhas da API", () => {
  test("informa a falha quando a listagem não pode ser carregada", async ({
    studentsPage: app,
    page,
  }) => {
    makeStudentsTableUnavailable();

    const listResponse = app.waitForListResponse();
    await page.goto("/");
    const response = await listResponse;

    expect(response.status()).toBe(500);
    await expect(app.listSection).toHaveAttribute("aria-busy", "false");
    await expect(app.listMessage).toHaveAttribute("data-state", "error");
    await expect(app.listMessage).toHaveText(
      "Não foi possível atualizar a lista de alunos. Erro interno do servidor.",
    );
    await expect(app.rows).toHaveCount(0);
  });

  test("informa a falha no cadastro e mantém os campos preenchidos", async ({
    studentsPage: app,
  }) => {
    await app.open();
    makeStudentsTableUnavailable();
    const student = { ra: 900040, name: "Aluno Durante Falha" };

    await app.fillForm(student.ra, student.name);
    const createResponse = app.waitForCreateResponse();
    await app.submitButton.click();
    const response = await createResponse;

    expect(response.status()).toBe(500);
    await expect(app.formMessage).toHaveText(
      "Não foi possível cadastrar o aluno. Erro interno do servidor.",
    );
    await expect(app.formMessage).toHaveAttribute("data-state", "error");
    await expect(app.raInput).toHaveValue(String(student.ra));
    await expect(app.nameInput).toHaveValue(student.name);
    await expect(app.submitButton).toBeEnabled();
    // A tabela exibida anteriormente não é alterada pela falha.
    await app.expectTableToContainExactly(SEED_STUDENTS);
  });
});
