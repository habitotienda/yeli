'use strict';

/* Spanish for the footer, the sign-up/login terms, What's new, Support and the Admin tabs (see i18n.js).
   Loaded after i18n-es.js. It only adds keys that the main dictionary doesn't have, so it never changes an older translation.
   The legal pages (About us, Terms, Cookies) are not here: they have both languages in legal.js. */
(() => {
    const ES = {
        /* footer */
        "Watch anything, live.": "Mira lo que quieras, en directo.",
        "About us": "Quiénes somos",
        "What’s new": "Novedades",
        "Support": "Soporte",
        "Legal": "Legal",
        "Terms and Conditions": "Términos y Condiciones",
        "Cookies Policy": "Política de Cookies",
        "Follow us": "Síguenos",
        "All rights reserved.": "Todos los derechos reservados.",

        /* login and sign-up */
        "By logging in you accept the": "Al iniciar sesión aceptas los",
        "I have read and accept the": "He leído y acepto los",
        "and the": "y la",
        "You must accept the Terms and Conditions and the Cookies Policy to create an account.": "Debes aceptar los Términos y Condiciones y la Política de Cookies para crear una cuenta.",

        /* What's new */
        "The latest changes and announcements.": "Los últimos cambios y anuncios.",
        "Nothing new yet": "Aún no hay novedades",
        "Announcements and changes will show up here.": "Aquí aparecerán los anuncios y cambios.",
        "Publish an update": "Publicar una novedad",

        /* Support */
        "Log in to contact Support": "Inicia sesión para escribir a Soporte",
        "Write to us and you will get the answer as a notification, and you can read it here.": "Escríbenos y recibirás la respuesta como una notificación; también podrás leerla aquí.",
        "Tell us what happened. We answer here and send you a notification.": "Cuéntanos qué pasó. Respondemos aquí y te enviamos una notificación.",
        "New request": "Nueva solicitud",
        "Topic": "Tema",
        "Subject": "Asunto",
        "Message": "Mensaje",
        "Send request": "Enviar solicitud",
        "My requests": "Mis solicitudes",
        "You have not written to Support yet.": "Aún no has escrito a Soporte.",
        "Request sent. You will get the answer as a notification.": "Solicitud enviada. Recibirás la respuesta como una notificación.",
        "My account": "Mi cuenta",
        "Payments and Yelis": "Pagos y Yelis",
        "Streaming and video": "Transmisión y video",
        "Something is broken": "Algo no funciona",
        "Report a user or content": "Denunciar a un usuario o contenido",
        "Something else": "Otra cosa",
        "Waiting for an answer": "Esperando respuesta",
        "Answered": "Respondida",
        "Closed": "Cerrada",
        "All my requests": "Todas mis solicitudes",
        "Inbox": "Bandeja",
        "From": "De",
        "Yeli Support": "Soporte de Yeli",
        "Support:": "Soporte:",
        "Your answer": "Tu respuesta",
        "Your message": "Tu mensaje",
        "Send answer": "Enviar respuesta",
        "Send": "Enviar",
        "Close request": "Cerrar solicitud",
        "This request is closed.": "Esta solicitud está cerrada.",
        "Open a new one": "Abre una nueva",
        "if you still need help.": "si aún necesitas ayuda.",
        "Answer sent.": "Respuesta enviada.",
        "Message sent.": "Mensaje enviado.",
        "Request closed.": "Solicitud cerrada.",
        "Close this request? Nobody will be able to write in it any more.": "¿Cerrar esta solicitud? Ya nadie podrá escribir en ella.",
        "Request not found": "Solicitud no encontrada",
        "That request doesn’t exist or isn’t yours.": "Esa solicitud no existe o no es tuya.",

        /* Admin hub */
        "Payments": "Pagos",
        "Updates": "Novedades",
        "Social links": "Redes sociales",
        "Admin sections": "Secciones de administración",
        "Filter": "Filtro",
        "All": "Todas",
        "Nothing here. When someone writes to Support you get a notification and the request shows up in this inbox.": "No hay nada aquí. Cuando alguien escriba a Soporte recibirás una notificación y la solicitud aparecerá en esta bandeja.",
        "It appears in": "Aparece en",
        ", newest first. Write it in the language your audience reads.": ", de la más reciente a la más antigua. Escríbela en el idioma que lee tu audiencia.",
        "Title": "Título",
        "Label (optional)": "Etiqueta (opcional)",
        "New, Fix, Event…": "Nuevo, Arreglo, Evento…",
        "Text": "Texto",
        "A blank line starts a new paragraph.": "Una línea en blanco empieza un párrafo nuevo.",
        "Publish": "Publicar",
        "Published": "Publicadas",
        "Date": "Fecha",
        "Delete": "Eliminar",
        "Nothing published yet.": "Aún no hay nada publicado.",
        "Update published.": "Novedad publicada.",
        "Delete this update?": "¿Eliminar esta novedad?",
        "Add a social network": "Añadir una red social",
        "These links appear in the footer of every page. Only https:// addresses are accepted.": "Estos enlaces aparecen en el pie de página de todas las páginas. Solo se aceptan direcciones https://.",
        "Network": "Red",
        "Name shown (optional)": "Nombre visible (opcional)",
        "Address": "Dirección",
        "Add": "Añadir",
        "In the footer now": "En el pie de página ahora",
        "Remove": "Quitar",
        "No social networks yet, so the footer shows none.": "Aún no hay redes sociales, así que el pie de página no muestra ninguna.",
        "Added to the footer.": "Añadida al pie de página.",
        "Removed from the footer.": "Quitada del pie de página.",

        /* notifications */
        "wrote to Support:": "escribió a Soporte:",
        "answered your request": "respondió a tu solicitud",
        "Support answers": "Respuestas de Soporte",
        "Yeli Support answers one of your requests.": "Soporte de Yeli responde a una de tus solicitudes.",
        "New Support requests": "Nuevas solicitudes de Soporte",
        "Someone writes to Support (admins only).": "Alguien escribe a Soporte (solo administradores).",

        /* messages from the server */
        "Pick a network from the list.": "Elige una red de la lista.",
        "Enter a valid https:// address.": "Escribe una dirección https:// válida.",
        "Write a title (at least 3 characters).": "Escribe un título (mínimo 3 caracteres).",
        "Write the text of the update.": "Escribe el texto de la novedad.",
        "Pick a topic from the list.": "Elige un tema de la lista.",
        "Write a subject (at least 3 characters).": "Escribe un asunto (mínimo 3 caracteres).",
        "Tell us a bit more (at least 10 characters).": "Cuéntanos un poco más (mínimo 10 caracteres).",
        "Wait a few seconds before sending another request.": "Espera unos segundos antes de enviar otra solicitud.",
        "That request doesn't exist.": "Esa solicitud no existe.",
        "Write your message.": "Escribe tu mensaje.",
        "This request is closed. Open a new one if you still need help.": "Esta solicitud está cerrada. Abre una nueva si aún necesitas ayuda.",
        "This conversation is too long. Open a new request.": "Esta conversación es demasiado larga. Abre una solicitud nueva.",
    };

    window.YELI_ES = window.YELI_ES || {};
    const have = new Set(Object.keys(window.YELI_ES).map((k) => k.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()));
    Object.entries(ES).forEach(([k, v]) => {
        const key = k.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
        if (!have.has(key)) window.YELI_ES[k] = v;
    });

    window.YELI_ES_PATTERNS = window.YELI_ES_PATTERNS || [];
    window.YELI_ES_PATTERNS.push(
        [/^You can add up to (\d+) social networks\.$/, 'Puedes añadir hasta $1 redes sociales.'],
        [/^You already have (\d+) open requests\. Close one or wait for an answer\.$/, 'Ya tienes $1 solicitudes abiertas. Cierra una o espera una respuesta.'],
        [/^(.+) wrote to Support: (.+)$/, 'Soporte: $1 escribió: $2'],
        [/^Yeli Support answered your request (.+)$/, 'Soporte de Yeli respondió a tu solicitud $1'],
    );
})();
