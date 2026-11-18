/**
 * Cenários obrigatórios da Atividade 2 – interface "Cadastro de alunos".
 *
 * Cada grupo (describe) corresponde a uma linha da tabela de cenários do
 * enunciado. Todos os testes usam a interface, a API Express e o PostgreSQL
 * reais, sem interceptar ou simular respostas. Antes de cada teste, a fixture
 * automática `resetDb` restaura o banco exclusivo E2E para os dados iniciais
 * conhecidos (SEED_STUDENTS), de modo que qualquer teste pode ser executado
 * sozinho ou em qualquer ordem.
 */
import {
  test,
  expect,
  MESSAGES,
  SEED_STUDENTS,
  sortByRa,
  type Student,
} from "./support";

test.describe("Listagem inicial", () => {
  test("exibe na tabela os alunos existentes no banco ao abrir a página", async ({
    studentsPage: app,
  }) => {
    const response = await app.open();

    // A API devolve exatamente os alunos do estado inicial conhecido.
    const body: Student[] = await response.json();
    expect(sortByRa(body)).toEqual(sortByRa(SEED_STUDENTS));

    // A tabela apresenta esses alunos, na mesma ordem recebida da API.
    await expect(
      app.table.getByRole("columnheader", { name: "RA" }),
    ).toBeVisible();
    await expect(
      app.table.getByRole("columnheader", { name: "Nome" }),
    ).toBeVisible();
    await app.expectTableInOrder(body);
    for (const student of SEED_STUDENTS) {
      await expect(app.row(student)).toBeVisible();
    }

    // Sem mensagem de lista vazia ou de erro.
    await expect(app.listMessage).toHaveText("");
    await expect(app.listMessage).toHaveAttribute("data-state", "success");
  });
});

test.describe("Cadastro válido", () => {
  test("cadastra aluno com RA e nome válidos e exibe mensagem de sucesso", async ({
    studentsPage: app,
  }) => {
    await app.open();
    const student = { ra: 900001, name: "Mariana Costa" };

    await app.raInput.fill(String(student.ra));
    await app.nameInput.fill(student.name);
    const createResponse = app.waitForCreateResponse();
    await app.submitButton.click();
    const created = await createResponse;

    // A interface enviou os dados digitados e a API real os gravou.
    expect(created.request().postDataJSON()).toEqual(student);
    expect(created.status()).toBe(201);
    expect(await created.json()).toEqual(student);

    // A mensagem de sucesso é apresentada ao usuário.
    await expect(app.formMessage).toHaveText(MESSAGES.success);
    await expect(app.formMessage).toHaveAttribute("data-state", "success");
    await expect(app.formMessage).toBeVisible();

    // O formulário fica disponível para um novo cadastro.
    await expect(app.submitButton).toBeEnabled();
    await expect(app.form).toHaveAttribute("aria-busy", "false");
  });
});

test.describe("Atualização da lista", () => {
  test("exibe o aluno recém-cadastrado na tabela sem recarregar a página", async ({
    studentsPage: app,
  }) => {
    await app.open();
    await app.expectTableToContainExactly(SEED_STUDENTS);
    const student = { ra: 900002, name: "Pedro Almeida" };
    await expect(app.row(student)).toHaveCount(0);

    // Marca o documento: se a página fosse recarregada, a marca se perderia.
    const marker = await app.markDocument();
    let navigations = 0;
    app.page.on("framenavigated", (frame) => {
      if (frame === app.page.mainFrame()) navigations++;
    });

    const { list } = await app.register(student);

    // A própria página consultou a lista novamente e recebeu o novo aluno.
    expect(await list.json()).toEqual(expect.arrayContaining([student]));

    // A tabela foi atualizada com o novo aluno, mantendo os anteriores.
    await expect(app.row(student)).toBeVisible();
    await app.expectTableToContainExactly([...SEED_STUDENTS, student]);

    // Nenhuma navegação/recarga ocorreu: o mesmo documento continua aberto.
    expect(await app.documentMarker()).toBe(marker);
    expect(navigations).toBe(0);
  });
});

test.describe("Limpeza do formulário", () => {
  test("deixa os campos RA e Nome vazios após o cadastro bem-sucedido", async ({
    studentsPage: app,
  }) => {
    await app.open();
    const student = { ra: 900003, name: "Juliana Ramos" };

    await app.fillForm(student.ra, student.name);
    await expect(app.raInput).toHaveValue(String(student.ra));
    await expect(app.nameInput).toHaveValue(student.name);

    await app.register(student);

    await expect(app.raInput).toHaveValue("");
    await expect(app.nameInput).toHaveValue("");
    // O foco volta ao RA, pronto para o próximo cadastro.
    await expect(app.raInput).toBeFocused();
  });
});

test.describe("Persistência", () => {
  test("mantém o aluno cadastrado na tabela após recarregar a página", async ({
    studentsPage: app,
  }) => {
    await app.open();
    const student = { ra: 900004, name: "Rafael Moreira" };
    await app.register(student);
    await expect(app.row(student)).toBeVisible();

    // Recarregar descarta o estado em memória; a lista vem do banco.
    const response = await app.reload();

    expect(await response.json()).toEqual(expect.arrayContaining([student]));
    await expect(app.row(student)).toBeVisible();
    await app.expectTableToContainExactly([...SEED_STUDENTS, student]);
    // Após recarregar, não há mais mensagem de cadastro: o dado veio do banco.
    await expect(app.formMessage).toHaveText("");
  });
});

test.describe("Campos obrigatórios", () => {
  const cases = [
    { title: "RA e Nome vazios", ra: "", name: "", empty: ["raInput", "nameInput"] },
    { title: "RA vazio", ra: "", name: "Aluno Sem RA", empty: ["raInput"] },
    { title: "Nome vazio", ra: "900005", name: "", empty: ["nameInput"] },
  ] as const;

  for (const scenario of cases) {
    test(`impede o cadastro com ${scenario.title}`, async ({
      studentsPage: app,
    }) => {
      await app.open();
      const posts = app.trackCreateRequests();

      await app.fillForm(scenario.ra, scenario.name);
      await app.submitButton.click();

      // O navegador sinaliza o campo obrigatório vazio.
      for (const field of scenario.empty) {
        const validity = await app.validity(app[field]);
        expect(validity.valueMissing).toBe(true);
        expect(validity.valid).toBe(false);
        expect(validity.message).not.toBe("");
      }
      // O campo preenchido mantém o valor digitado.
      await expect(app.raInput).toHaveValue(scenario.ra);
      await expect(app.nameInput).toHaveValue(scenario.name);

      // O cadastro não foi iniciado: sem mensagem e sem alteração na tabela.
      await expect(app.formMessage).toHaveText("");
      await expect(app.submitButton).toBeEnabled();
      await app.expectTableToContainExactly(SEED_STUDENTS);

      // Confirma no servidor que nada foi gravado e que não houve POST.
      await app.reload();
      await app.expectTableToContainExactly(SEED_STUDENTS);
      expect(posts).toHaveLength(0);
    });
  }
});

test.describe("RA inválido", () => {
  const cases = [
    { title: "negativo", ra: "-5", flag: "rangeUnderflow" },
    { title: "zero", ra: "0", flag: "rangeUnderflow" },
    { title: "decimal", ra: "1.5", flag: "stepMismatch" },
    { title: "maior que 2147483647", ra: "2147483648", flag: "rangeOverflow" },
  ] as const;

  for (const scenario of cases) {
    test(`rejeita RA ${scenario.title} (${scenario.ra})`, async ({
      studentsPage: app,
    }) => {
      await app.open();
      const posts = app.trackCreateRequests();
      const name = "Nome Valido";

      await app.fillForm(scenario.ra, name);
      await app.submitButton.click();

      // A regra violada é identificada pela validação do campo RA.
      const validity = await app.validity(app.raInput);
      expect(validity.valid).toBe(false);
      expect(validity[scenario.flag]).toBe(true);
      expect(validity.message).not.toBe("");

      // Os valores digitados permanecem para correção.
      await expect(app.raInput).toHaveValue(scenario.ra);
      await expect(app.nameInput).toHaveValue(name);

      // Nada foi cadastrado.
      await expect(app.formMessage).toHaveText("");
      await expect(app.submitButton).toBeEnabled();
      await app.expectTableToContainExactly(SEED_STUDENTS);
      await app.reload();
      await app.expectTableToContainExactly(SEED_STUDENTS);
      expect(posts).toHaveLength(0);
    });
  }
});

test.describe("Nome inválido", () => {
  // Nomes curtos são barrados pelo minlength="3" do próprio campo. Nomes que só
  // ficam curtos após remover os espaços das extremidades passam pelo minlength
  // e são barrados pela validação da página, com mensagem personalizada.
  const cases = [
    { title: "com 1 caractere", name: "A", rule: "tooShort" },
    { title: "com 2 caracteres", name: "Jo", rule: "tooShort" },
    {
      title: "com 2 caracteres e espaços nas extremidades",
      name: "   Jo   ",
      rule: "customError",
    },
    { title: "somente com espaços", name: "      ", rule: "customError" },
  ] as const;

  for (const scenario of cases) {
    test(`rejeita nome ${scenario.title}`, async ({ studentsPage: app }) => {
      await app.open();
      const posts = app.trackCreateRequests();
      const ra = "900006";

      await app.fillForm(ra, scenario.name);
      await app.submitButton.click();

      // O campo Nome é marcado como inválido pela regra correspondente.
      const validity = await app.validity(app.nameInput);
      expect(validity.valid).toBe(false);
      expect(validity[scenario.rule]).toBe(true);
      expect(validity.message).not.toBe("");
      if (scenario.rule === "customError") {
        expect(validity.message).toBe(MESSAGES.shortName);
      }
      // O RA era válido: a rejeição se deve somente ao nome.
      expect((await app.validity(app.raInput)).valid).toBe(true);

      // Os valores digitados permanecem para correção.
      await expect(app.raInput).toHaveValue(ra);
      await expect(app.nameInput).toHaveValue(scenario.name);

      // Nada foi cadastrado.
      await expect(app.formMessage).toHaveText("");
      await expect(app.submitButton).toBeEnabled();
      await app.expectTableToContainExactly(SEED_STUDENTS);
      await app.reload();
      await app.expectTableToContainExactly(SEED_STUDENTS);
      expect(posts).toHaveLength(0);
    });
  }
});

test.describe("RA duplicado", () => {
  test("rejeita o cadastro, exibe erro e mantém os campos preenchidos", async ({
    studentsPage: app,
  }) => {
    await app.open();
    const existing = SEED_STUDENTS[0];
    const duplicate = { ra: existing.ra, name: "Outro Aluno" };

    await app.fillForm(duplicate.ra, duplicate.name);
    const createResponse = app.waitForCreateResponse();
    await app.submitButton.click();
    const response = await createResponse;

    // A requisição chegou à API real, que detectou o conflito no banco.
    expect(response.request().postDataJSON()).toEqual(duplicate);
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({
      statusCode: 409,
      message: "Já existe um estudante com este RA.",
    });

    // A mensagem de erro é apresentada ao usuário.
    await expect(app.formMessage).toHaveText(MESSAGES.duplicateRa);
    await expect(app.formMessage).toHaveAttribute("data-state", "error");
    await expect(app.formMessage).toBeVisible();

    // Os campos continuam preenchidos e o botão volta a ficar disponível.
    await expect(app.raInput).toHaveValue(String(duplicate.ra));
    await expect(app.nameInput).toHaveValue(duplicate.name);
    await expect(app.submitButton).toBeEnabled();

    // O aluno original não foi alterado e nenhum registro foi adicionado.
    await expect(app.row(existing)).toBeVisible();
    await app.expectTableToContainExactly(SEED_STUDENTS);
    await app.reload();
    await expect(app.row(existing)).toBeVisible();
    await app.expectTableToContainExactly(SEED_STUDENTS);
  });
});

test.describe("Lista vazia", () => {
  // Para este grupo, o banco é restaurado sem nenhum aluno.
  test.use({ initialStudents: [] });

  test("exibe “Nenhum aluno cadastrado.” quando não existem alunos", async ({
    studentsPage: app,
  }) => {
    const response = await app.open();

    expect(await response.json()).toEqual([]);
    await expect(app.listMessage).toHaveText(MESSAGES.emptyList);
    await expect(app.listMessage).toBeVisible();
    await expect(app.rows).toHaveCount(0);
  });

  test("remove a mensagem de lista vazia após o primeiro cadastro", async ({
    studentsPage: app,
  }) => {
    await app.open();
    await expect(app.listMessage).toHaveText(MESSAGES.emptyList);

    const student = { ra: 900007, name: "Primeiro Aluno" };
    await app.register(student);

    await expect(app.listMessage).toHaveText("");
    await app.expectTableToContainExactly([student]);
  });
});
