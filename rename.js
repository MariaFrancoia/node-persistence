import fs from "fs";
import path from "path";

const pastaBase = "E:\\Contratos\\organizer\\PlanoPrata";

function renomearPasta(diretorio) {
  const itens = fs.readdirSync(diretorio, { withFileTypes: true });

  for (const item of itens) {
    if (!item.isDirectory()) continue;

    const nomeAtual = item.name;

    const match = nomeAtual.match(/^(\d+)/);

    if (!match) continue;

    const novoNome = match[1];

    if (nomeAtual === novoNome) continue;

    const caminhoAtual = path.join(diretorio, nomeAtual);
    const novoCaminho = path.join(diretorio, novoNome);

    if (fs.existsSync(novoCaminho)) {
      console.log(`Pasta já existe: ${novoNome}`);
      continue;
    }

    fs.renameSync(caminhoAtual, novoCaminho);

    console.log(`Renomeado: ${nomeAtual} -> ${novoNome}`);
  }
}

renomearPasta(pastaBase);