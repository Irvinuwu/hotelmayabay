// =========================
// CONFIGURACIÓN SUPABASE
// =========================

const SUPABASE_URL = "https://wgghzekcygcqgnhuqsxf.supabase.co";
const SUPABASE_KEY = "sb_publishable_iF4g46qS_CszmYDWXLH8eA_RS34HwQ7";

// Inicializamos con un nombre único para evitar choques con el CDN global
const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY
);

console.log("Supabase conectado correctamente");

// =========================
// REGLAS DE NEGOCIO (LOGICA BACKEND/SERVIDOR EN CLIENTE)
// =========================

/**
 * Verifica si el tipo de habitación tiene disponibilidad para las fechas seleccionadas
 * Límite total de flota: 40 habitaciones (15 Deluxe, 15 Premium, 10 Presidencial)
 */
async function verificarDisponibilidadHabitacion(tipoHabitacion, nuevaEntrada, nuevaSalida) {
    // Consulta para contar cuántas habitaciones de ese tipo ya están ocupadas y se traslapan con las nuevas fechas
    const { count, error } = await supabaseClient
        .from("reservas_habitacion")
        .select("*", { count: "exact", head: true })
        .eq("habitacion", tipoHabitacion)
        .lt("fecha_entrada", nuevaSalida) // fecha_entrada de la BD es menor que la nueva salida del cliente
        .gt("fecha_salida", nuevaEntrada);  // fecha_salida de la BD es mayor que la nueva entrada del cliente

    if (error) {
        console.error("Error al verificar disponibilidad de habitación:", error.message);
        return false;
    }

    // Definición de límites por tipo de habitación (Suma total = 40 habitaciones)
    const limitesHabitacion = {
        "Deluxe": 15,
        "Premium": 15,
        "Presidencial": 10
    };

    // Si las habitaciones ya ocupadas son menores al límite permitido, hay disponibilidad
    const limiteMaximo = limitesHabitacion[tipoHabitacion] || 0;
    return count < limiteMaximo;
}

/**
 * Verifica si las 3 camionetas tienen capacidad para un traslado en la fecha de entrada
 * Capacidad máxima combinada de la flota de 3 vans = 30 pasajeros por día
 */
async function verificarCupoTraslado(fechaTraslado) {
    // Obtenemos todos los traslados programados para esa fecha
    const { data, error } = await supabaseClient
        .from("reservas_traslado")
        .select("costo") // Traemos cualquier columna para contar los registros existentes
        .eq("fecha_traslado", fechaTraslado);

    if (error) {
        console.error("Error al verificar cupo de traslado:", error.message);
        return false;
    }

    // Suponiendo que cada registro equivale a 1 solicitud de traslado ocupando espacio en la flota.
    // Si tus 3 camionetas pueden atender un máximo de 3 solicitudes simultáneas por día:
    const MAX_SOLICITUDES_TRASLADO = 3; 

    return data.length < MAX_SOLICITUDES_TRASLADO;
}

// =========================
// CALENDARIO
// =========================

flatpickr("#rangoFechas", {
    locale: "es",
    mode: "range",
    dateFormat: "d/m/Y",
    minDate: "today",

    onClose: function(selectedDates) {
        if (selectedDates.length === 2) {
            document.getElementById("entrada").value =
                flatpickr.formatDate(selectedDates[0], "Y-m-d");

            document.getElementById("salida").value =
                flatpickr.formatDate(selectedDates[1], "Y-m-d");
        }
    }
});

// =========================
// FORMULARIO DE RESERVA
// =========================

const formulario = document.getElementById("formReserva");

if (formulario) {
    formulario.addEventListener("submit", async function(e) {
        e.preventDefault();

        const cliente = document.querySelector("[name='cliente']").value;
        const correo = document.querySelector("[name='correo']").value;
        const entrada = document.getElementById("entrada").value;
        const salida = document.getElementById("salida").value;
        const habitacion = document.querySelector("[name='habitacion']").value;
        const traslado = document.getElementById("traslado").checked;

        // --- VALIDACIONES DE DISPONIBILIDAD ANTES DE INSERTAR ---
        
        // 1. Validar choque de fechas en Habitaciones
        const habitacionDisponible = await verificarDisponibilidadHabitacion(habitacion, entrada, salida);
        if (!habitacionDisponible) {
            alert(`Lo sentimos, no quedan habitaciones de tipo "${habitacion}" disponibles para el rango de fechas seleccionado.`);
            return; // Frena la ejecución del submit
        }

        // 2. Validar sobreventa en Camionetas de Traslado
        if (traslado) {

    // CONSULTAR CAMIONETAS DISPONIBLES

    const { count: disponibles, error: errorCamionetas } =
        await supabaseClient
        .from("camionetas")
        .select("*", {
            count: "exact",
            head: true
        })
        .eq("estado", "Disponible");

    if (errorCamionetas) {

        console.error(errorCamionetas);

        alert("Error al verificar disponibilidad de transporte");

        return;
    }

    // NO HAY CAMIONETAS

    if (disponibles <= 0) {

        alert(
            "Lo sentimos, no contamos con disponibilidad de transporte al aeropuerto."
        );

        return;
    }

    const idReserva = data[0].id_reserva;

    const { error: errorTraslado } =
        await supabaseClient
        .from("reservas_traslado")
        .insert([
            {
                id_reserva: idReserva,
                fecha_traslado: entrada,
                costo: 25
            }
        ]);

    if (errorTraslado) {

        console.error(errorTraslado);

        alert("No fue posible registrar el traslado");
    }
}

        // --- INSERCIÓN SI TODAS LAS REGLAS SE CUMPLEN ---

        // RESERVA HABITACIÓN
        const { data, error } = await supabaseClient
            .from("reservas_habitacion")
            .insert([
                {
                    cliente,
                    correo,
                    fecha_entrada: entrada,
                    fecha_salida: salida,
                    habitacion
                }
            ])
            .select();

        if (error) {
            console.error(error);
            alert("Error al registrar la reserva:\n" + error.message);
            return;
        }

        // RESERVA TRASLADO
        if (traslado && data && data.length > 0) {
            const idReserva = data[0].id_reserva;

            const { error: errorTraslado } = await supabaseClient
                .from("reservas_traslado")
                .insert([
                    {
                        id_reserva: idReserva,
                        fecha_traslado: entrada,
                        costo: 25
                    }
                ]);

            if (errorTraslado) {
                console.error("Error al registrar traslado:", errorTraslado.message);
            }
        }

        alert("¡Reserva registrada correctamente!");
        formulario.reset();

        cargarDashboard();
        cargarReservas();
    });
}

// =========================
// DASHBOARD
// =========================

async function cargarDashboard() {
    const ocupadasElemento = document.getElementById("ocupadas");
    const camionetasElemento = document.getElementById("camionetas");
    const reservasHoyElemento = document.getElementById("reservasHoy");

    if (!ocupadasElemento || !camionetasElemento || !reservasHoyElemento) {
        return;
    }

    // HABITACIONES TOTALES OCUPADAS
    const { count: ocupadas } = await supabaseClient
        .from("reservas_habitacion")
        .select("*", { count: "exact", head: true });

    ocupadasElemento.textContent = ocupadas || 0;

    // CAMIONETAS DISPONIBLES
    const { count: ocupadasTraslado } = await supabaseClient
        .from("reservas_traslado")
        .select("*", { count: "exact", head: true });
        
    // Si tenemos 3 camionetas en total, restamos las que ya tienen traslados agendados
    const totalCamionetas = 3;
    const disponibles = totalCamionetas - (ocupadasTraslado || 0);

    camionetasElemento.textContent = disponibles < 0 ? 0 : disponibles;

    // RESERVAS DEL DÍA (Basado en la fecha de entrada de hoy)
    const hoy = new Date().toISOString().split("T")[0];
    const inicioDelDia = `${hoy}T00:00:00.000Z`;

    const { count: reservasHoy, error: errorHoy } = await supabaseClient
        .from("reservas_habitacion")
        .select("*", { count: "exact", head: true })
        .gte("fecha_entrada", inicioDelDia);

    if (errorHoy) {
        console.error("Error cargando reservas del día:", errorHoy.message);
    }

    reservasHoyElemento.textContent = reservasHoy || 0;
}

// =========================
// TABLA DE RESERVAS
// =========================

async function cargarReservas() {
    const tabla = document.getElementById("listaReservas");
    if (!tabla) return;

    const { data, error } = await supabaseClient
        .from("reservas_habitacion")
        .select("*")
        .order("id_reserva", { ascending: false })
        .limit(5);

    if (error) {
        console.error(error);
        return;
    }

    tabla.innerHTML = "";

    // Mapeo optimizado de las filas de la tabla
    const filasHTML = data.map(reserva => `
        <tr>
            <td>${reserva.cliente}</td>
            <td>${reserva.habitacion}</td>
            <td>${reserva.fecha_entrada}</td>
            <td>${reserva.fecha_salida}</td>
        </tr>
    `).join('');

    tabla.innerHTML = filasHTML;
}

// CARGA INICIAL AL ENTRAR A LA PÁGINA
cargarDashboard();
cargarReservas();