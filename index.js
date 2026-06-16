import express from "express";
import fs from "fs/promises";
import path from "path";
import axios from "axios";
import multer from "multer";
import cors from "cors";
import { randomUUID } from "crypto";
import fsSync from "fs";

const app = express();

app.use(
  cors({
    origin: "http://localhost:8080",
    methods: ["GET", "POST"],
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const caminhoBase = "E:/Contratos";

// MULTER CONFIG
if (!fsSync.existsSync("temp")) {
  fsSync.mkdirSync("temp", { recursive: true });
}
const upload = multer({
  dest: "temp/",
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB por arquivo
  },
});

let cacheResultado = null;
let carregando = false;

// ROTA DE UPLOAD EXTERNO
app.post("/upload-externo", upload.array("files"), async (req, res) => {
  let arquivosTemporarios = [];

  try {
    const { relative_path, inscricao } = req.body;

    if (!relative_path) {
      return res.status(400).json({ erro: "relative_path obrigatório" });
    }

    const cleanPath = relative_path.replace(/^\/+/, "");
    const fullPathParts = cleanPath.split("/");

    console.log("UPLOAD PATH:", relative_path);
    console.log("FILES COUNT:", req.files?.length);

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ erro: "Nenhum arquivo enviado" });
    }

    arquivosTemporarios = req.files.map((f) => f.path) || [];

    const normalizedPath = path.normalize(cleanPath);

    if (normalizedPath.includes("..")) {
      return res.status(400).json({ erro: "Path inválido" });
    }

    if (fullPathParts.length < 3) {
      return res.status(400).json({
        erro: "Estrutura de path insuficiente (esperado: Categoria/Plano/Inscricao)",
      });
    }

    const categoriaNome = fullPathParts[0].trim();
    const planoNome = fullPathParts[1].trim();
    const inscricaoPath = fullPathParts[2];

    console.log("categoriaNome", categoriaNome);
    console.log("planoNome", planoNome);
    console.log("inscricaoPath", inscricaoPath);
    console.log("req.body", req.body);

    const baseCategoria = path.join(caminhoBase, categoriaNome);
    const pastaPlano = path.join(caminhoBase, categoriaNome, planoNome);
    console.log("basecategoria", baseCategoria);
    console.log("pastaPlano", pastaPlano);

    if (!fsSync.existsSync(baseCategoria)) {
      return res.status(400).json({
        erro: `Categoria '${categoriaNome}' não existe em ${caminhoBase}`,
      });
    }

    if (!fsSync.existsSync(pastaPlano)) {
      return res.status(400).json({
        erro: `Plano '${planoNome}' não encontrado no caminho: ${categoriaNome}`,
      });
    }

    const finalDir = path.join(caminhoBase, normalizedPath);
    console.log("finalDir", finalDir);

    if (!fsSync.existsSync(finalDir)) {
      await fs.mkdir(finalDir, { recursive: true });
    }

    let arquivosSalvos = [];
    let erros = [];

    for (const file of req.files) {
      try {
        const ext = path.extname(file.originalname).toLowerCase();
        const fileName = `${randomUUID()}${ext}`;
        const finalPath = path.join(finalDir, fileName);

        await fs.copyFile(file.path, finalPath);

        const nomeOriginal = Buffer.from(file.originalname, "latin1").toString(
          "utf8",
        );

        arquivosSalvos.push({
          nome_original: nomeOriginal,
          nome_salvo: fileName,
          caminho: path.join(normalizedPath, fileName).replace(/\\/g, "/"),
        });
      } catch (err) {
        erros.push(file.originalname);
      }
    }

    await atualizarCacheDepoisMudanca();

    return res.json({
      success: erros.length === 0,
      path: normalizedPath,
      inscricao,
      arquivos: arquivosSalvos,
      errors: erros,
    });
  } catch (err) {
    console.error("Erro real:", err.message);

    return res.status(500).json({
      erro: "Falha no upload",
    });
  } finally {
    for (const filePath of arquivosTemporarios) {
      try {
        const tempDir = path.resolve("temp");

        if (path.resolve(filePath).startsWith(tempDir)) {
          await fs.unlink(filePath);
        }
      } catch (err) {}
    }
  }
});

async function atualizarCacheDepoisMudanca() {
  try {
    await carregarCache();
    console.log("Cache atualizado após mudança");
  } catch (err) {
    console.error("Erro ao atualizar cache:", err);
  }
}

//MESCLA ARQUIVOS EXISTENTES
app.post("/merge-folders", async (req, res) => {
  const { sourcePath, destinationPath } = req.body;

  // Validação simples dos caminhos enviados
  if (!sourcePath || !destinationPath) {
    return res
      .status(400)
      .json({ error: "Caminhos de origem e destino são obrigatórios." });
  }

  // CRUCIAL: Monta o caminho físico absoluto usando o seu caminhoBase
  const fullSourcePath = path.join(caminhoBase, sourcePath);
  const fullDestinationPath = path.join(caminhoBase, destinationPath);

  // Proteção contra caminhos maliciosos (Path Traversal)
  if (sourcePath.includes("..") || destinationPath.includes("..")) {
    return res.status(400).json({ error: "Caminhos inválidos." });
  }

  try {
    // 1. Verifica se a pasta de origem existe.
    try {
      await fs.access(fullSourcePath);
    } catch {
      return res
        .status(404)
        .json({ error: "Pasta de origem não encontrada no HD." });
    }

    // 2. Garante que a pasta de destino exista (se não existir, cria)
    await fs.mkdir(fullDestinationPath, { recursive: true });

    // 3. Lê todos os arquivos de dentro da pasta de origem
    const items = await fs.readdir(fullSourcePath);

    for (const item of items) {
      if (item === "Thumbs.db") continue; // Ignora lixo do Windows

      const oldItemPath = path.join(fullSourcePath, item);
      let newItemPath = path.join(fullDestinationPath, item);

      // Evita sobrescrever arquivos se eles tiverem o mesmo nome exato
      const ext = path.extname(item);
      const base = path.basename(item, ext);
      let counter = 1;

      while (true) {
        try {
          await fs.access(newItemPath);
          // Se o arquivo existe no destino, incrementa o nome
          newItemPath = path.join(
            fullDestinationPath,
            `${base}_${counter}${ext}`,
          );
          counter++;
        } catch {
          // Caminho livre
          break;
        }
      }

      // Move o arquivo para o destino final
      await fs.rename(oldItemPath, newItemPath);
    }

    // 4. Agora que a pasta de origem está completamente vazia, nós a removemos
    // Usamos fs.rm com recursive para garantir que limpe resíduos vazios
    await fs.rm(fullSourcePath, { recursive: true, force: true });

    // 5. OTIMIZAÇÃO: Atualiza a estrutura de cache do Node imediatamente
    if (cacheResultado) {
      // Remove do cache a pasta antiga que foi apagada
      const antigasPartes = path
        .normalize(sourcePath)
        .replace(/\\/g, "/")
        .split("/");
      if (antigasPartes.length >= 3) {
        const [oldCat, oldPla, oldIns] = antigasPartes;
        cacheResultado = cacheResultado.filter(
          (i) =>
            !(
              i.categoria === oldCat &&
              i.plano === oldPla &&
              i.full_name_paste === oldIns
            ),
        );
      }
    }

    // Força a atualização completa em background para garantir a consistência
    acionarRecargaDebounced();

    return res.status(200).json({
      success: true,
      message: "Arquivos mesclados e pasta antiga removida com sucesso.",
    });
  } catch (error) {
    console.error("Erro ao mesclar pastas:", error);
    return res.status(500).json({
      error: "Erro interno ao mesclar as pastas no HD.",
      details: error.message,
    });
  }
});

// ROTA PARA VISUALIZAR OS ARQUIVOS
app.get("/view-file", (req, res) => {
  const relPath = req.query.path;
  if (!relPath || relPath.includes("..")) {
    return res.status(400).send("Path inválido");
  }

  const fullPath = path.join(caminhoBase, relPath);
  if (!fullPath.startsWith(path.resolve(caminhoBase))) {
    return res.status(400).send("Path inválido");
  }

  res.sendFile(fullPath, (err) => {
    if (err && !res.headersSent) {
      return res.status(404).send("Arquivo não encontrado");
    }
  });
});

// DELETE FILE
app.post("/delete-file", async (req, res) => {
  try {
    const { path: relPath } = req.body;
    if (!relPath || relPath.includes("..")) {
      return res.status(400).json({ success: false, message: "Path inválido" });
    }

    const fullPath = path.join(caminhoBase, relPath);
    if (!fsSync.existsSync(fullPath)) {
      return res
        .status(404)
        .json({ success: false, message: "Arquivo não encontrado" });
    }

    await fs.unlink(fullPath);

    // OTIMIZAÇÃO: Remove do cache local imediatamente
    if (cacheResultado) {
      const partes = path.normalize(relPath).replace(/\\/g, "/").split("/");
      if (partes.length >= 4) {
        const [cat, pla, ins, arq] = partes;
        const item = cacheResultado.find(
          (i) =>
            i.categoria === cat && i.plano === pla && i.full_name_paste === ins,
        );
        if (item) {
          item.arquivos = item.arquivos.filter((f) => f !== arq);
        }
      }
    }

    return res.json({ success: true, message: "Arquivo removido" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// MOVER PASTA
app.post("/move-folder", async (req, res) => {
  try {
    const { oldPath, newPath } = req.body || {};
    if (
      !oldPath ||
      !newPath ||
      oldPath.includes("..") ||
      newPath.includes("..")
    ) {
      return res.status(400).json({ message: "Paths inválidos" });
    }

    const oldFolder = path.join(caminhoBase, oldPath);
    const newFolder = path.join(caminhoBase, newPath);

    if (!fsSync.existsSync(oldFolder)) {
      return res.status(404).json({ message: "Pasta origem não encontrada" });
    }

    await fs.mkdir(path.dirname(newFolder), { recursive: true });

    if (oldFolder !== newFolder) {
      await fs.rename(oldFolder, newFolder);
    }

    // Como houve mudança estrutural de diretórios, forçamos a recarga do cache em background
    acionarRecargaDebounced();

    return res.json({ success: true });
  } catch (err) {
    console.error("move-folder error:", err);
    return res.status(500).json({ message: "Erro ao mover pasta" });
  }
});

// LER HD (CORE)
async function lerHD() {
  const categorias = await fs.readdir(caminhoBase);
  // console.log("categorias", categorias);

  let resultado = [];

  for (const categoria of categorias) {
    const categoriaPath = path.join(caminhoBase, categoria);
    // console.log("categoriaPath", categoriaPath);

    const planos = await fs.readdir(categoriaPath);
    // console.log("planos", planos);

    for (const plano of planos) {
      const planoPath = path.join(categoriaPath, plano);
      // console.log("planoPath", planoPath);

      const inscricoes = await fs.readdir(planoPath);
      // console.log("inscricoes", inscricoes);

      if (inscricoes.length === 0) {
        resultado.push({
          categoria,
          plano,
          inscricao: null,
          nome: null,
          arquivos: [],
        });
        continue;
      }

      for (const inscricao of inscricoes) {
        const inscricaoPath = path.join(planoPath, inscricao);
        // console.log("inscricaoPath", inscricaoPath);

        const match = inscricao.match(/^(\d+)/);

        if (!match) {
          console.log("Pasta inválida:", inscricao);
          continue;
        }

        const regex = /^(\d+)\s*-?\s*(.*)$/;

        const partes = inscricao.match(regex);

        const numeroInscricao = partes?.[1] || null;

        const nome = partes?.[2]?.trim() || null;

        const arquivos = (await fs.readdir(inscricaoPath)).filter(
          (file) => file !== "Thumbs.db",
        );

        resultado.push({
          categoria,
          plano,
          full_name_paste: inscricao,
          inscricao: numeroInscricao,
          nome,
          arquivos,
        });
      }
    }
  }
  return resultado;
}

// GERENCIAMENTO DE CACHE SEGURO
let timeoutRecarga = null;
function acionarRecargaDebounced() {
  if (timeoutRecarga) clearTimeout(timeoutRecarga);
  timeoutRecarga = setTimeout(() => {
    carregarCache();
  }, 1000); // Aguarda 1 segundo de ociosidade de eventos para re-ler o disco
}

async function carregarCache() {
  if (carregando) return;
  try {
    carregando = true;
    console.log("Recarregando cache do HD...");
    cacheResultado = await lerHD();
    console.log(
      "Cache atualizado com sucesso. Total de registros:",
      cacheResultado.length,
    );
  } catch (err) {
    console.error("Erro ao carregar cache: ", err);
  } finally {
    carregando = false;
  }
}

function atualizarCacheLocalItem(cat, pla, ins, novosArquivos) {
  let item = cacheResultado.find(
    (i) => i.categoria === cat && i.plano === pla && i.full_name_paste === ins,
  );
  if (!item) {
    const match = ins.match(/^(\d+)/);
    item = {
      categoria: cat,
      plano: pla,
      full_name_paste: ins,
      inscricao: match ? match[1] : null,
      nome: ins,
      arquivos: [],
    };
    cacheResultado.push(item);
  }
  item.arquivos = [...new Set([...item.arquivos, ...novosArquivos])];
}

async function limparArquivosTemporarios(arquivos) {
  for (const filePath of arquivos) {
    try {
      if (path.resolve(filePath).startsWith(path.resolve("temp"))) {
        await fs.unlink(filePath);
      }
    } catch {}
  }
}

// ENDPOINTS DE CONSULTA
app.get("/sync-hd", async (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  const offset = parseInt(req.query.offset) || 0;

  console.log("QUERY:", req.query);

  if (!cacheResultado || cacheResultado.length === 0) {
    return res.status(503).json({
      message: "Cache ainda carregando",
      error: "Cache ainda carregando",
    });
  }

  const paginado = cacheResultado.slice(offset, offset + limit);

  console.log(`Enviado ${paginado.length} registros (offset ${offset})`);

  res.json(paginado);
});

app.get("/check-inscricao/:inscricao", async (req, res) => {
  try {
    const { inscricao } = req.params;
    if (!cacheResultado) {
      return res.status(503).json({ message: "Cache inicializando" });
    }

    const encontrados = cacheResultado.filter(
      (item) => item.inscricao === inscricao,
    );
    const contracts = encontrados.map((item) => ({
      categoria: item.categoria,
      plano: item.plano,
      inscricao: item.inscricao,
      full_name_paste: item.full_name_paste,
      full_path: `${item.categoria}/${item.plano}/${item.full_name_paste}`,
      arquivos: item.arquivos,
    }));

    return res.json({ exists: contracts.length > 0, contracts });
  } catch (err) {
    return res.status(500).json({ message: "Erro interno ao procurar" });
  }
});

// LISTAR ARQUIVOS DA PASTA
app.get("/list-files", async (req, res) => {
  try {
    const { path: relPath } = req.query;
    if (!relPath || relPath.includes("..")) {
      return res.status(400).json({ error: "Path inválido" });
    }

    const fullPath = path.join(caminhoBase, relPath);
    if (!fsSync.existsSync(fullPath)) {
      return res.status(404).json({ error: "Pasta não encontrada" });
    }

    const files = await fs.readdir(fullPath);
    const result = files
      .filter((f) => f !== "Thumbs.db")
      .map((f) => ({
        name: f,
        path: path.join(relPath, f).replace(/\\/g, "/"),
      }));

    return res.json({ files: result });
  } catch (err) {
    return res.status(500).json({ error: "Erro ao listar arquivos" });
  }
});

// EXECUÇÃO PERIODICA (A cada 2 dias)
setInterval(() => carregarCache(), 1000 * 60 * 60 * 24 * 2);

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", async () => {
  await carregarCache();
  console.log(`Servidor rodando na porta ${PORT}`);
});
