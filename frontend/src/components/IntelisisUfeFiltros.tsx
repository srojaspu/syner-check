import type { Column } from "@tanstack/react-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
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

const OPCIONES_RESULTADO = [
  { value: "CONFORME", label: "Conforme" },
  { value: "REVISAR", label: "Revisar" },
];

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

const OPCIONES_ESTADO = [
  { value: "generado", label: "Generado" },
  { value: "error_validacion", label: "Error de validación" },
  { value: "omitido_validacion", label: "Omitido en validación" },
  { value: "sin_bloque", label: "Sin bloque de tipo" },
  { value: "en_proceso", label: "En proceso" },
  { value: "sin_registro", label: "Sin registro" },
  { value: "fuera_de_bitacora", label: "Fuera de bitácora" },
];

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
    if (filtros.resultado && fila.resultado !== filtros.resultado) return false;
    if (filtros.estado && fila.estado_generacion !== filtros.estado) {
      return false;
    }
    if (filtros.tipo && fila.tipo !== filtros.tipo) return false;
    if (filtros.generador && fila.generador !== filtros.generador) {
      return false;
    }
    if (filtros.sunat && fila.estado_sunat !== filtros.sunat) return false;
    if (filtros.incidencia) {
      const existe = (fila.incidencias ?? []).some(
        (item) => item.toUpperCase() === filtros.incidencia!.toUpperCase(),
      );
      if (!existe) return false;
    }
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
  const alternar = (clave: keyof IntelisisUfeFiltros, valor: string) => {
    const actual = filtros[clave];
    const esIgual = String(actual ?? "") === valor;
    const siguiente: IntelisisUfeFiltros = { ...filtros };
    if (esIgual) {
      delete siguiente[clave];
    } else {
      siguiente[clave] = valor as never;
    }
    onCambio(siguiente);
  };

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
      case "resultado":
        return (
          <div className="flex flex-col gap-1">
            <FiltroSelect
              label="Resultado"
              value={filtros.resultado ?? ""}
              placeholder="Todos"
              options={OPCIONES_RESULTADO}
              onChange={(valor) => alternar("resultado", valor)}
            />
            {/* La columna Revisión muestra el motivo: su filtro va aqui. */}
            <FiltroSelect
              label="Incidencia"
              value={filtros.incidencia ?? ""}
              placeholder="Todas"
              options={(kpis?.por_incidencia ?? []).map((item) => ({
                value: item.key,
                label: `${item.key} (${item.count})`,
              }))}
              onChange={(valor) => alternar("incidencia", valor)}
            />
          </div>
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
      case "estado_generacion":
        return (
          <FiltroSelect
            label="Estado"
            value={filtros.estado ?? ""}
            placeholder="Todos"
            options={OPCIONES_ESTADO}
            onChange={(valor) => alternar("estado", valor)}
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
