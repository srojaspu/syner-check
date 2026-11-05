import { useCallback, useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Cancel01Icon,
  Delete02Icon,
  Edit02Icon,
  Loading02Icon,
  RefreshIcon,
  Search01Icon,
  Store01Icon,
  TriangleAlertIcon,
} from "@hugeicons/core-free-icons";
import { toast } from "sonner";
import {
  AuthError,
  createSerieSucursal,
  deleteSerieSucursal,
  getSeriesSucursales,
  updateSerieSucursal,
} from "../api/client";
import type {
  SerieSucursal,
  SerieSucursalCreateRequest,
  SerieSucursalUpdateRequest,
} from "../api/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SerieSucursalPageProps {
  onAuthFailure: () => void;
}

type FilterStatus = "todas" | "con_serie" | "sin_serie";

export default function SerieSucursalPage({
  onAuthFailure,
}: SerieSucursalPageProps) {
  const [items, setItems] = useState<SerieSucursal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("todas");

  // Diálogos modales
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SerieSucursal | null>(null);
  const [deletingItem, setDeletingItem] = useState<SerieSucursal | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSeriesSucursales();
      setItems(data);
    } catch (err) {
      if (err instanceof AuthError) {
        onAuthFailure();
        return;
      }
      const msg =
        err instanceof Error
          ? err.message
          : "No se pudo cargar el catálogo de sucursales.";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [onAuthFailure]);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  // Contadores para filtros
  const counts = useMemo(() => {
    let conSerie = 0;
    let sinSerie = 0;
    for (const item of items) {
      if (item.seriesynerpos) conSerie++;
      else sinSerie++;
    }
    return { todas: items.length, conSerie, sinSerie };
  }, [items]);

  // Filtrado reactivo en cliente (búsqueda y estado)
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      // Filtro de estado
      if (statusFilter === "con_serie" && !item.seriesynerpos) return false;
      if (statusFilter === "sin_serie" && Boolean(item.seriesynerpos)) return false;

      // Filtro de texto
      if (!q) return true;
      const sucursalStr = String(item.sucursal);
      const nombreStr = item.nombre.toLowerCase();
      const prefijoStr = item.prefijo.toLowerCase();
      const serieStr = (item.seriesynerpos ?? "").toLowerCase();

      return (
        sucursalStr.includes(q) ||
        nombreStr.includes(q) ||
        prefijoStr.includes(q) ||
        serieStr.includes(q)
      );
    });
  }, [items, search, statusFilter]);

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 max-w-7xl mx-auto w-full">
      {/* Encabezado principal */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              icon={Store01Icon}
              size={22}
              strokeWidth={2}
              className="text-primary"
              aria-hidden
            />
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Series por Sucursal
            </h1>
            <Badge variant="outline" className="font-mono text-xs">
              dbo.SerieSucursal
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Catálogo de tiendas y asignación de códigos de serie para emisión
            en SynerPOS.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void fetchItems()}
            title="Refrescar catálogo"
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              size={15}
              strokeWidth={2}
              className={loading ? "animate-spin" : ""}
              aria-hidden
            />
            <span className="sr-only sm:not-sr-only sm:inline-block">
              Refrescar
            </span>
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={() => setIsCreateOpen(true)}
            className="gap-1.5"
          >
            <HugeiconsIcon
              icon={Add01Icon}
              size={16}
              strokeWidth={2}
              aria-hidden
            />
            Nueva Sucursal
          </Button>
        </div>
      </div>

      {/* Alerta de error si falla la carga */}
      {error ? (
        <Alert variant="destructive">
          <HugeiconsIcon icon={TriangleAlertIcon} aria-hidden />
          <AlertTitle>Error al conectar con la base de datos</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-2">
            <span>{error}</span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void fetchItems()}
            >
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Barra de herramientas: Búsqueda y Filtros de estado */}
      <Card>
        <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <HugeiconsIcon
              icon={Search01Icon}
              size={16}
              strokeWidth={2}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              aria-hidden
            />
            <Input
              type="text"
              placeholder="Buscar por código, tienda, prefijo o serie…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-8"
              aria-label="Buscar sucursales"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 rounded-sm"
                aria-label="Limpiar búsqueda"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={14} aria-hidden />
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
            <span className="text-xs text-muted-foreground mr-1 hidden sm:inline">
              Filtro:
            </span>
            <Button
              type="button"
              size="xs"
              variant={statusFilter === "todas" ? "secondary" : "ghost"}
              onClick={() => setStatusFilter("todas")}
              className="rounded-full"
            >
              Todas
              <Badge variant="outline" className="ml-1 px-1.5 py-0 text-[10px]">
                {counts.todas}
              </Badge>
            </Button>
            <Button
              type="button"
              size="xs"
              variant={statusFilter === "con_serie" ? "secondary" : "ghost"}
              onClick={() => setStatusFilter("con_serie")}
              className="rounded-full"
            >
              Con serie
              <Badge variant="outline" className="ml-1 px-1.5 py-0 text-[10px]">
                {counts.conSerie}
              </Badge>
            </Button>
            <Button
              type="button"
              size="xs"
              variant={statusFilter === "sin_serie" ? "secondary" : "ghost"}
              onClick={() => setStatusFilter("sin_serie")}
              className="rounded-full"
            >
              Sin serie
              <Badge variant="outline" className="ml-1 px-1.5 py-0 text-[10px]">
                {counts.sinSerie}
              </Badge>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabla de Sucursales */}
      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28 font-mono">Sucursal</TableHead>
                <TableHead>Nombre de Tienda</TableHead>
                <TableHead className="w-32 font-mono">Prefijo</TableHead>
                <TableHead className="w-36 font-mono">Serie SynerPOS</TableHead>
                <TableHead className="w-24 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-5 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-48" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-14" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="h-7 w-16 ml-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredItems.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center py-12 text-muted-foreground"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <HugeiconsIcon
                        icon={Store01Icon}
                        size={28}
                        className="text-muted-foreground/60"
                        aria-hidden
                      />
                      <p className="font-medium text-foreground">
                        No se encontraron sucursales
                      </p>
                      <p className="text-xs">
                        {search
                          ? "Intenta con otro término de búsqueda."
                          : "No hay registros disponibles en el catálogo."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredItems.map((item) => (
                  <TableRow
                    key={item.sucursal}
                    className="hover:bg-muted/40 transition-colors"
                  >
                    <TableCell className="font-mono font-medium tabular-nums text-foreground">
                      #{item.sucursal}
                    </TableCell>
                    <TableCell className="font-medium">
                      {item.nombre}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs px-2 py-0.5 rounded-sm bg-muted text-muted-foreground border">
                        {item.prefijo}
                      </span>
                    </TableCell>
                    <TableCell>
                      {item.seriesynerpos ? (
                        <Badge
                          variant="secondary"
                          className="font-mono font-semibold tracking-wider text-xs"
                        >
                          {item.seriesynerpos}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">
                          Sin serie
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setEditingItem(item)}
                          title={`Editar sucursal #${item.sucursal}`}
                          aria-label={`Editar sucursal #${item.sucursal}`}
                        >
                          <HugeiconsIcon
                            icon={Edit02Icon}
                            size={14}
                            strokeWidth={2}
                            aria-hidden
                          />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setDeletingItem(item)}
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          title={`Eliminar sucursal #${item.sucursal}`}
                          aria-label={`Eliminar sucursal #${item.sucursal}`}
                        >
                          <HugeiconsIcon
                            icon={Delete02Icon}
                            size={14}
                            strokeWidth={2}
                            aria-hidden
                          />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Modal para Crear / Editar */}
      <SerieSucursalFormDialog
        open={isCreateOpen || Boolean(editingItem)}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreateOpen(false);
            setEditingItem(null);
          }
        }}
        initialData={editingItem}
        onSuccess={() => {
          setIsCreateOpen(false);
          setEditingItem(null);
          void fetchItems();
        }}
        onAuthFailure={onAuthFailure}
      />

      {/* Modal de confirmación de Eliminación */}
      <SerieSucursalDeleteDialog
        item={deletingItem}
        open={Boolean(deletingItem)}
        onOpenChange={(open) => {
          if (!open) setDeletingItem(null);
        }}
        onSuccess={() => {
          setDeletingItem(null);
          void fetchItems();
        }}
        onAuthFailure={onAuthFailure}
      />
    </div>
  );
}

/* ========================================================================= */
/* Form Dialog (Creación y Edición)                                         */
/* ========================================================================= */

interface SerieSucursalFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData: SerieSucursal | null;
  onSuccess: (saved: SerieSucursal) => void;
  onAuthFailure: () => void;
}

function SerieSucursalFormDialog({
  open,
  onOpenChange,
  initialData,
  onSuccess,
  onAuthFailure,
}: SerieSucursalFormDialogProps) {
  const isEdit = Boolean(initialData);
  const [sucursal, setSucursal] = useState<string>("");
  const [nombre, setNombre] = useState<string>("");
  const [prefijo, setPrefijo] = useState<string>("");
  const [serie, setSerie] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    if (initialData) {
      setSucursal(String(initialData.sucursal));
      setNombre(initialData.nombre);
      setPrefijo(initialData.prefijo);
      setSerie(initialData.seriesynerpos ?? "");
    } else {
      setSucursal("");
      setNombre("");
      setPrefijo("");
      setSerie("");
    }
  }, [open, initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const sucursalNum = Number(sucursal.trim());
    if (!isEdit && (!sucursalNum || sucursalNum <= 0)) {
      setFormError("El código de sucursal debe ser un número entero positivo.");
      return;
    }
    const nombreClean = nombre.trim();
    if (!nombreClean) {
      setFormError("El nombre de la tienda es obligatorio.");
      return;
    }

    setBusy(true);
    try {
      if (isEdit && initialData) {
        const payload: SerieSucursalUpdateRequest = {
          nombre: nombreClean,
          prefijo: prefijo.trim() ? prefijo : undefined,
          seriesynerpos: serie.trim().toUpperCase() || null,
        };
        const updated = await updateSerieSucursal(initialData.sucursal, payload);
        toast.success(`Sucursal #${updated.sucursal} actualizada.`);
        onSuccess(updated);
      } else {
        const payload: SerieSucursalCreateRequest = {
          sucursal: sucursalNum,
          nombre: nombreClean,
          prefijo: prefijo.trim() ? prefijo : undefined,
          seriesynerpos: serie.trim().toUpperCase() || null,
        };
        const created = await createSerieSucursal(payload);
        toast.success(`Sucursal #${created.sucursal} creada exitosamente.`);
        onSuccess(created);
      }
    } catch (err: unknown) {
      if (err instanceof AuthError) {
        onAuthFailure();
        return;
      }
      const msg =
        err instanceof Error
          ? err.message
          : "No se pudo guardar la configuración de sucursal.";
      setFormError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      preventOutsideDismiss
      onOpenChange={(val) => {
        if (busy) return;
        onOpenChange(val);
      }}
    >
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HugeiconsIcon
                icon={Store01Icon}
                size={18}
                strokeWidth={2}
                aria-hidden
              />
              {isEdit
                ? `Editar Sucursal #${initialData?.sucursal}`
                : "Nueva Sucursal"}
            </DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Actualiza el nombre, prefijo contable o la serie de emisión asignada en SynerPOS."
                : "Registra una nueva tienda y configura su serie para emisión de comprobantes."}
            </DialogDescription>
          </DialogHeader>

          {formError ? (
            <Alert variant="destructive">
              <HugeiconsIcon icon={TriangleAlertIcon} aria-hidden />
              <AlertTitle>No se pudo guardar</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="sucursal-codigo">Código de Sucursal</Label>
              <Input
                id="sucursal-codigo"
                type="number"
                min="1"
                max="999999"
                required
                disabled={isEdit || busy}
                value={sucursal}
                onChange={(e) => setSucursal(e.target.value)}
                placeholder="Ej. 104"
                className="font-mono tabular-nums"
              />
              <span className="text-xs text-muted-foreground">
                {isEdit
                  ? "El código numérico no se puede modificar una vez creado."
                  : "Identificador numérico único de la sucursal (1 al 999999)."}
              </span>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="sucursal-nombre">Nombre de la Tienda</Label>
              <Input
                id="sucursal-nombre"
                type="text"
                maxLength={100}
                required
                disabled={busy}
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej. Tienda Jockey Plaza"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="sucursal-prefijo">Prefijo Contable (ERP)</Label>
              <Input
                id="sucursal-prefijo"
                type="text"
                maxLength={10}
                disabled={busy}
                value={prefijo}
                onChange={(e) => setPrefijo(e.target.value)}
                placeholder={sucursal ? `${sucursal}- ` : "Ej. 104- "}
                className="font-mono"
              />
              <span className="text-xs text-muted-foreground">
                Opcional. Si se deja en blanco se auto-asigna{" "}
                <code className="font-mono text-foreground font-medium">
                  {sucursal ? `${sucursal}- ` : "{sucursal}- "}
                </code>
                .
              </span>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="sucursal-serie">Serie SynerPOS</Label>
              <Input
                id="sucursal-serie"
                type="text"
                maxLength={10}
                disabled={busy}
                value={serie}
                onChange={(e) => setSerie(e.target.value.toUpperCase())}
                placeholder="Ej. 004, S02, S20 (vacío si no emite)"
                className="font-mono uppercase font-semibold"
              />
              <span className="text-xs text-muted-foreground">
                Código de 3 caracteres asignado en SynerPOS. Debe ser único en
                toda la empresa. Déjalo en blanco si el local no emite.
              </span>
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <HugeiconsIcon
                  icon={Loading02Icon}
                  size={15}
                  strokeWidth={2}
                  className="animate-spin"
                  aria-hidden
                />
              ) : null}
              {busy
                ? "Guardando…"
                : isEdit
                  ? "Guardar Cambios"
                  : "Crear Sucursal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ========================================================================= */
/* Delete Confirmation Dialog                                               */
/* ========================================================================= */

interface SerieSucursalDeleteDialogProps {
  item: SerieSucursal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  onAuthFailure: () => void;
}

function SerieSucursalDeleteDialog({
  item,
  open,
  onOpenChange,
  onSuccess,
  onAuthFailure,
}: SerieSucursalDeleteDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  if (!item) return null;

  const handleDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteSerieSucursal(item.sucursal);
      toast.success(`Sucursal #${item.sucursal} eliminada exitosamente.`);
      onSuccess();
    } catch (err: unknown) {
      if (err instanceof AuthError) {
        onAuthFailure();
        return;
      }
      const msg =
        err instanceof Error
          ? err.message
          : `No se pudo eliminar la sucursal #${item.sucursal}.`;
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      preventOutsideDismiss
      onOpenChange={(val) => {
        if (busy) return;
        onOpenChange(val);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon
              icon={Delete02Icon}
              size={18}
              strokeWidth={2}
              className="text-destructive"
              aria-hidden
            />
            Eliminar Sucursal #{item.sucursal}
          </DialogTitle>
          <DialogDescription>
            ¿Estás seguro de que deseas eliminar esta sucursal del catálogo de
            series de SynerPOS?
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 rounded-lg border p-3.5 text-sm bg-muted/30">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">Sucursal:</span>
            <span className="font-mono font-semibold">#{item.sucursal}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">Tienda:</span>
            <span className="font-medium text-foreground">{item.nombre}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">Prefijo:</span>
            <span className="font-mono text-xs">{item.prefijo}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">
              Serie SynerPOS:
            </span>
            <span className="font-mono font-semibold text-xs">
              {item.seriesynerpos || "Ninguna"}
            </span>
          </div>
        </div>

        <Alert variant="destructive">
          <HugeiconsIcon icon={TriangleAlertIcon} aria-hidden />
          <AlertTitle>Acción destructiva</AlertTitle>
          <AlertDescription>
            Si esta tienda emite comprobantes en SynerPOS, eliminar su
            configuración impedirá validar su correlativo y serie de emisión.
          </AlertDescription>
        </Alert>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Error al eliminar</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter className="mt-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => void handleDelete()}
          >
            {busy ? (
              <HugeiconsIcon
                icon={Loading02Icon}
                size={15}
                strokeWidth={2}
                className="animate-spin"
                aria-hidden
              />
            ) : (
              <HugeiconsIcon
                icon={Delete02Icon}
                size={15}
                strokeWidth={2}
                aria-hidden
              />
            )}
            {busy ? "Eliminando…" : "Eliminar Sucursal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
