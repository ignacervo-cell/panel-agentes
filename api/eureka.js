import { extractText, getDocumentProxy } from "unpdf";

// Eureka (Poder Judicial del Chubut) – acceso como usuario anónimo.
// Solo usa la vista pública: fallos anonimizados, sin credenciales.
const BASE = "https://apps1cloud.juschubut.gov.ar";
const MAX_CHARS_TEXTO = 150000;

async function abrirSesionAnonima() {
  const res = await fetch(`${BASE}/Eureka/`, { redirect: "manual" });
  const cookies = res.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  // Mismo pedido que hace el botón "Ingresar" como anónimo.
  await fetch(`${BASE}/eureka/Home/RegistrarAccesoAnonimo`, { headers: { Cookie: cookies } });
  return cookies;
}

function linkPdf(id) {
  return `${BASE}/eureka/Sentencias/BajarDocumentoPublicable?idSentencia=${id}&anonimo=true`;
}

async function buscar({ texto = "", anio = "", pagina = 1 }) {
  const cookies = await abrirSesionAnonima();
  const params = new URLSearchParams({
    Texto: texto,
    Organismos: "",
    Competencias: "",
    Anios: anio,
    Tipo: "",
    Numero: "",
    EsFraseExacta: "false",
    EsBusquedaAmplia: "false",
    EsNuevaBusqueda: "",
    IdBusqueda: "",
    EsBusquedaAvanzada: "false",
    SortDirection: "",
    SortKey: "",
    PageIndex: String(pagina),
  });
  const res = await fetch(`${BASE}/eureka/Sentencias/BuscarPorCriterios?${params}`, {
    headers: { Cookie: cookies, Accept: "application/json" },
  });
  if (!res.headers.get("content-type")?.includes("json")) {
    throw new Error("Eureka no devolvió resultados (sesión rechazada)");
  }
  const data = await res.json();
  return {
    total: data.totalFilas,
    pagina: data.pageIndex,
    paginas: data.pageCount,
    resultados: data.rows.map(r => ({
      id: r.id,
      sentencia: `${r.cell.numero}/${r.cell.anio}`,
      organismo: r.cell.organismo.trim(),
      competencia: r.cell.competencia.trim(),
      tipo: r.cell.protocolo,
      fechaFirma: r.cell.fechaFirma,
      pdf: linkPdf(r.id),
    })),
  };
}

function htmlATexto(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .trim();
}

async function leer({ id }) {
  if (!/^\d+$/.test(String(id))) throw new Error("id inválido");

  const [detalleRes, pdfRes] = await Promise.all([
    fetch(`${BASE}/eureka/Sentencias/DetallePublicable?idSentencia=${id}&anonimo=true`),
    fetch(linkPdf(id)),
  ]);
  if (!pdfRes.headers.get("content-type")?.includes("pdf")) {
    throw new Error("Eureka no devolvió el PDF de esa sentencia");
  }

  const ficha = htmlATexto(await detalleRes.text())
    .replace(/Ver Antecedentes[\s\S]*$/, "")
    .trim();

  const pdf = await getDocumentProxy(new Uint8Array(await pdfRes.arrayBuffer()));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });

  return {
    id: Number(id),
    pdf: linkPdf(id),
    paginas: totalPages,
    ficha,
    texto: text.slice(0, MAX_CHARS_TEXTO),
    textoRecortado: text.length > MAX_CHARS_TEXTO,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { accion, texto, anio, pagina, id } = req.query;
  try {
    if (accion === "buscar") return res.status(200).json(await buscar({ texto, anio, pagina }));
    if (accion === "leer") return res.status(200).json(await leer({ id }));
    return res.status(400).json({ error: "accion debe ser 'buscar' o 'leer'" });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
}
