import type { Column } from "@tanstack/react-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ERP_ESTADO_LABEL } from "./IntelisisUfeEstados";
import type {
  IntelisisUfeFiltros,
  IntelisisUfeKpis,
  IntelisisUfeRow,
} from "../api/types";

const ALL = "__all";

export function FiltroSelect({
  label,
  value,
  placeholder,
  options,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value || ALL}
      onValueChange={(next) => onChange(!next || next === ALL ? "" : next)}
    >
      <SelectTrigger
        size="sm"
        className="h-8 w-full min-w-0 sm:min-w-28"
        aria-label={label}
      >
        <SelectValue>
          {(current) =>
            !current || current === ALL
              ? placeholder
              : (options.find((option) => option.value === current)?.label ??
                String(current))
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Todos</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const OPCIONES_GENERADOR = [
  { value: "OK REGISTRADO", label: "OK registrado" },
  { value: "SIN OK", label: "Sin OK" },
  { value: "SIN TRAZA", label: "Sin traza" },
  { value: "NO APLICA", label: "No aplica" },
];

const OPCIONES_TIPO = [
  { value: "BO", label: "Boleta" },
  { value: "FA", label: "Factura" },
  { value: "NC", label: "Nota de crédito" },
  { value: "ND", label: "Nota de débito" },
];

const OPCIONES_SUNAT = [
  { value: "ACEPTADO", label: "Aceptado" },
  { value: "SUNAT NO ENCONTRADO", label: "No encontrado" },
  { value: "SUNAT NO ACEPTADO", label: "No aceptado" },
  { value: "SUNAT SIN CONSULTA", label: "Sin consulta" },
];

/**
 * Mismo criterio que usa el servidor para los KPIs derivados del Validador.
 *
 * No son valores de `estado_generacion`: agrupan filas por incidencia, por
 * estatus del ERP, por la ventana de gracia o por exención del generador.
 */
function cumpleDerivado(fila: IntelisisUfeRow, derivado: string): boolean {
  switch (derivado) {
    case "sin_traza":
      return fila.incidencias.includes("SIN TRAZA");
    case "pendientes_conclusion":
      return (
        fila.estatus_erp === "PENDIENTE" &&
        fila.estado_generacion === "sin_registro" &&
        !fila.exento_generador
      );
    case "en_espera":
      return fila.en_espera;
    case "no_aplica":
      return fila.exento_generador;
    default:
      return false;
  }
}

/**
 * Filtra las filas cargadas en el navegador (al instante).
 *
 * Son los filtros de la fila de la tabla. El tipo de documento del panel de
 * periodo NO esta aqui: ese acota la consulta al servidor, como en la
 * pantalla de comprobantes.
 */
export function filtraUfeFilas(
  filas: IntelisisUfeRow[],
  filtros: IntelisisUfeFiltros,
): IntelisisUfeRow[] {
  const texto = (valor: unknown) => String(valor ?? "").trim();
  const aguja = (filtros.q ?? "").trim().toLowerCase();

  return filas.filter((fila) => {
    if (filtros.estado && fila.estado_generacion !== filtros.estado) {
      return false;
    }
    if (filtros.derivado && !cumpleDerivado(fila, filtros.derivado)) {
      return false;
    }
    if (filtros.tipo && fila.tipo !== filtros.tipo) return false;
    if (filtros.generador && fila.generador !== filtros.generador) {
      return false;
    }
    if (filtros.sunat && fila.estado_sunat !== filtros.sunat) return false;
    if (filtros.estatus && fila.estatus_erp !== filtros.estatus) return false;
    if (filtros.sucursal !== undefined && fila.sucursal !== filtros.sucursal) {
      return false;
    }
    if (aguja) {
      const campos = [
        fila.comprobante,
        fila.documento,
        fila.cliente,
        fila.mov_id,
        fila.mov,
        fila.sucursal_nombre,
        fila.cliente_codigo,
        String(fila.id_venta),
      ].map(texto);
      if (!campos.some((campo) => campo.toLowerCase().includes(aguja))) {
        return false;
      }
    }
    return true;
  });
}

/** Alterna un filtro del borrador: elegir el valor activo lo quita. */
export function aplicaFiltro(
  filtros: IntelisisUfeFiltros,
  clave: keyof IntelisisUfeFiltros,
  valor: string,
): IntelisisUfeFiltros {
  const esIgual = String(filtros[clave] ?? "") === valor;
  const siguiente: IntelisisUfeFiltros = { ...filtros };
  if (esIgual) {
    delete siguiente[clave];
  } else {
    siguiente[clave] = valor as never;
  }
  return siguiente;
}

/**
 * Fila de filtros de la tabla (la misma de la pantalla de comprobantes).
 *
 * Los filtros se aplican en el servidor, asi que viven en el borrador de
 * la pagina y se consultan al pulsar "Consultar".
 */
export function creaRenderFiltro(
  filtros: IntelisisUfeFiltros,
  onCambio: (filtros: IntelisisUfeFiltros) => void,
  kpis: IntelisisUfeKpis | null,
): (column: Column<IntelisisUfeRow>) => React.ReactNode {
  const alternar = (clave: keyof IntelisisUfeFiltros, valor: string) =>
    onCambio(aplicaFiltro(filtros, clave, valor));

  return (column) => {
    switch (column.id) {
      case "documento":
        return (
          <Input
            value={filtros.q ?? ""}
            onChange={(event) => onCambio({ ...filtros, q: event.target.value })}
            placeholder="Documento, cliente…"
            aria-label="Buscar por documento o cliente"
            className="h-8"
          />
        );
      case "generador":
        return (
          <FiltroSelect
            label="Generador"
            value={filtros.generador ?? ""}
            placeholder="Todos"
            options={OPCIONES_GENERADOR}
            onChange={(valor) => alternar("generador", valor)}
          />
        );
      case "tipo":
        return (
          <FiltroSelect
            label="Tipo"
            value={filtros.tipo ?? ""}
            placeholder="Todos"
            options={OPCIONES_TIPO}
            onChange={(valor) => alternar("tipo", valor)}
          />
        );
      case "sunat":
        return (
          <FiltroSelect
            label="SUNAT"
            value={filtros.sunat ?? ""}
            placeholder="Todos"
            options={OPCIONES_SUNAT}
            onChange={(valor) => alternar("sunat", valor)}
          />
        );
      case "estatus":
        return (
          <FiltroSelect
            label="ERP"
            value={filtros.estatus ?? ""}
            placeholder="Todos"
            options={(kpis?.por_estatus_listado ?? []).map((item) => ({
              value: item.key,
              label:
                ERP_ESTADO_LABEL[
                  item.key as keyof typeof ERP_ESTADO_LABEL
                ] ?? item.key,
            }))}
            onChange={(valor) => alternar("estatus", valor)}
          />
        );
      case "sucursal":
        return (
          <FiltroSelect
            label="Sucursal"
            value={filtros.sucursal ? String(filtros.sucursal) : ""}
            placeholder="Todas"
            options={(kpis?.por_sucursal ?? []).map((item) => ({
              value: String(item.sucursal),
              label: `${item.sucursal} · ${item.nombre}`,
            }))}
            onChange={(valor) =>
              onCambio({
                ...filtros,
                ...(valor
                  ? { sucursal: Number(valor) }
                  : { sucursal: undefined }),
              })
            }
          />
        );
      default:
        return null;
    }
  };
}
