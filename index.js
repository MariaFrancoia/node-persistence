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

//MULTER CONFIG
if (!fsSync.existsSync("temp")) {
  fsSync.mkdirSync("temp", { recursive: true });
}
const upload = multer({
  dest: "temp/",
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB por arquivo
  },
});

//ROTA DE UPLOAD
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

    const categoriaNome = fullPathParts[0].toLowerCase().trim();
    const planoNome = fullPathParts[1].toLowerCase().trim();
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

    return res.json({
      success: erros.length === 0,
      path: normalizedPath,
      inscricao,
      arquivos: arquivosSalvos,
      errors: erros,
    });
    console.log(res);
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

//ROTA PARA VISUALIZAR OS ARQUIVOS
app.get("/view-file", (req, res) => {
  const relPath = req.query.path;

  if (!relPath) {
    return res.status(400).send("Caminho não fornecido");
  }

  if (relPath.includes("..")) {
    return res.status(400).send("Path inválido");
  }

  const fullPath = path.join(caminhoBase, relPath);

  if (!fullPath.startsWith(path.resolve(caminhoBase))) {
    return res.status(400).send("Path inválido");
  }

  res.sendFile(fullPath, (err) => {
    if (err) {
      return res.status(404).send("Arquivo não encontrado");
    }
  });
});

//SINCRONIZAÇÃO BD -> BANCO
let cacheResultado = null;
let carregando = false;

async function carregarCache() {
  if (carregando) {
    console.log("Já está carregando, ignorando...");
    return;
  }

  try {
    carregando = true;
    console.log("Recarregando cache do HD");

    const resultado = await lerHD();

    cacheResultado = resultado;

    console.log("Cache atualizado:", resultado.length);
  } catch (err) {
    console.error("Erro ao carregar cache: ", err);
  } finally {
    carregando = false;
  }
}

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

        const numeroInscricao = match[1];
        const nome = inscricao.replace(numeroInscricao, "").trim();

        const arquivos = (await fs.readdir(inscricaoPath)).filter(
          (file) => file !== "Thumbs.db",
        );

        resultado.push({
          categoria,
          plano,
          inscricao: numeroInscricao,
          nome,
          arquivos,
        });
      }
    }
  }
  return resultado;
}

app.get("/sync-hd", async (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  const offset = parseInt(req.query.offset) || 0;

  console.log("QUERY:", req.query);

  if (!cacheResultado || cacheResultado.length === 0) {
    return res.status(503).json({
      error: "Cache ainda carregando",
    });
  }

  const paginado = cacheResultado.slice(offset, offset + limit);

  console.log(`Enviado ${paginado.length} registros (offset ${offset})`);

  res.json(paginado);
});

const dois_dias = 1000 * 60 * 60 * 24 * 2;

setInterval(() => {
  carregarCache();
}, dois_dias);

//START
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", async () => {
  await carregarCache();
  console.log(
    `Servidor deve estar rodando em todas a interfaces na porta ${PORT}`,
  );
});
