// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SerieSucursal } from "../api/types";
import SerieSucursalPage from "./SerieSucursalPage";

afterEach(cleanup);

const mockGet = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockDelete = vi.hoisted(() => vi.fn());

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    getSeriesSucursales: mockGet,
    createSerieSucursal: mockCreate,
    updateSerieSucursal: mockUpdate,
    deleteSerieSucursal: mockDelete,
  };
});

const SAMPLE_DATA: SerieSucursal[] = [
  {
    sucursal: 102,
    nombre: "Tienda Mall Caracol",
    prefijo: "102- ",
    seriesynerpos: "S02",
  },
  {
    sucursal: 104,
    nombre: "Tienda Jockey Plaza",
    prefijo: "104- ",
    seriesynerpos: "004",
  },
  {
    sucursal: 108,
    nombre: "Asia",
    prefijo: "108- ",
    seriesynerpos: null,
  },
];

describe("SerieSucursalPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue([...SAMPLE_DATA]);
  });

  it("renderiza la tabla con los registros cargados", async () => {
    render(<SerieSucursalPage onAuthFailure={vi.fn()} />);

    expect(screen.getByText("Series por Sucursal")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Tienda Mall Caracol")).toBeTruthy();
      expect(screen.getByText("Tienda Jockey Plaza")).toBeTruthy();
      expect(screen.getByText("Asia")).toBeTruthy();
      expect(screen.getByText("#102")).toBeTruthy();
      expect(screen.getByText("#104")).toBeTruthy();
      expect(screen.getByText("#108")).toBeTruthy();
    });
  });

  it("filtra sucursales por búsqueda de texto", async () => {
    render(<SerieSucursalPage onAuthFailure={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Tienda Mall Caracol")).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText(/Buscar por código/i);
    fireEvent.change(searchInput, { target: { value: "Jockey" } });

    expect(screen.getByText("Tienda Jockey Plaza")).toBeTruthy();
    expect(screen.queryByText("Tienda Mall Caracol")).toBeNull();
    expect(screen.queryByText("Asia")).toBeNull();
  });

  it("filtra por estado: con serie y sin serie", async () => {
    render(<SerieSucursalPage onAuthFailure={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Tienda Mall Caracol")).toBeTruthy();
    });

    // Clic en "Sin serie"
    fireEvent.click(screen.getByRole("button", { name: /Sin serie/i }));
    expect(screen.getByText("Asia")).toBeTruthy();
    expect(screen.queryByText("Tienda Mall Caracol")).toBeNull();
    expect(screen.queryByText("Tienda Jockey Plaza")).toBeNull();

    // Clic en "Con serie"
    fireEvent.click(screen.getByRole("button", { name: /Con serie/i }));
    expect(screen.getByText("Tienda Mall Caracol")).toBeTruthy();
    expect(screen.getByText("Tienda Jockey Plaza")).toBeTruthy();
    expect(screen.queryByText("Asia")).toBeNull();
  });

  it("permite abrir el modal de creación y registrar una nueva sucursal", async () => {
    const newItem: SerieSucursal = {
      sucursal: 120,
      nombre: "Boutique Dior",
      prefijo: "120- ",
      seriesynerpos: "S12",
    };
    mockCreate.mockResolvedValueOnce(newItem);

    render(<SerieSucursalPage onAuthFailure={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Tienda Jockey Plaza")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Nueva Sucursal/i }));

    expect(screen.getByText("Código de Sucursal")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Código de Sucursal/i), {
      target: { value: "120" },
    });
    fireEvent.change(screen.getByLabelText(/Nombre de la Tienda/i), {
      target: { value: "Boutique Dior" },
    });
    fireEvent.change(screen.getByLabelText(/Serie SynerPOS/i), {
      target: { value: "s12" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Crear Sucursal/i }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        sucursal: 120,
        nombre: "Boutique Dior",
        prefijo: undefined,
        seriesynerpos: "S12",
      });
    });
  });

  it("permite abrir el modal de edición y actualizar un registro", async () => {
    const updatedItem: SerieSucursal = {
      ...SAMPLE_DATA[2],
      nombre: "Asia Renovada",
      seriesynerpos: "S08",
    };
    mockUpdate.mockResolvedValueOnce(updatedItem);

    render(<SerieSucursalPage onAuthFailure={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Asia")).toBeTruthy();
    });

    const editBtn = screen.getByRole("button", {
      name: "Editar sucursal #108",
    });
    fireEvent.click(editBtn);

    expect(screen.getByText("Editar Sucursal #108")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Nombre de la Tienda/i), {
      target: { value: "Asia Renovada" },
    });
    fireEvent.change(screen.getByLabelText(/Serie SynerPOS/i), {
      target: { value: "s08" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Guardar Cambios/i }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(108, {
        nombre: "Asia Renovada",
        prefijo: "108- ",
        seriesynerpos: "S08",
      });
    });
  });

  it("permite eliminar una sucursal previa confirmación", async () => {
    mockDelete.mockResolvedValueOnce({ mensaje: "Eliminada" });

    render(<SerieSucursalPage onAuthFailure={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Asia")).toBeTruthy();
    });

    const deleteBtn = screen.getByRole("button", {
      name: "Eliminar sucursal #108",
    });
    fireEvent.click(deleteBtn);

    expect(screen.getByText("Eliminar Sucursal #108")).toBeTruthy();
    expect(screen.getByText(/Acción destructiva/i)).toBeTruthy();

    const confirmBtn = screen.getByRole("button", {
      name: "Eliminar Sucursal",
    });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith(108);
    });
  });

  it("no se cierra al hacer clic afuera del modal", async () => {
    render(<SerieSucursalPage onAuthFailure={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Tienda Jockey Plaza")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Nueva Sucursal/i }));
    expect(screen.getByText("Código de Sucursal")).toBeTruthy();

    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    if (overlay) {
      fireEvent.pointerDown(overlay);
      fireEvent.click(overlay);
    }
    // El modal sigue abierto
    expect(screen.getByText("Código de Sucursal")).toBeTruthy();

    // Solo se cierra al hacer clic en Cancelar
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => {
      expect(screen.queryByText("Código de Sucursal")).toBeNull();
    });
  });
});
