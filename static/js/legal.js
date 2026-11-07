'use strict';

/* =========================================================================
   Yeli legal texts: Terms and Conditions, Cookies Policy and About us.
   Every text exists in Spanish and English; site.js shows the one that matches the interface language.
   They are NOT run through the i18n dictionary (see data-no-i18n in site.js).

   When you change the texts in a way that matters to people, change TERMS_VERSION in yeli/config.py too
   (it is stored with each account when the person signs up or logs in) and the "updated" date below.
   Shape: { title, updated, intro: [paragraphs], sections: [{ h, p: [paragraphs], ul: [bullets], table: { head, rows } }] }
   ========================================================================= */
window.YELI_LEGAL = {
    terms: {
        es: {
            title: 'Términos y Condiciones',
            updated: 'Última actualización: 7 de noviembre de 2026',
            intro: [
                'Estos Términos y Condiciones (los «Términos») regulan el uso de Yeli, una plataforma de streaming con cuentas, chat, seguidores, estudio de transmisión, editor de video y una economía de monedas virtuales llamadas Yelis (el «Servicio»). Léelos con calma: al crear una cuenta o iniciar sesión aceptas estos Términos y la Política de Cookies.',
            ],
            sections: [
                {
                    h: 'Aceptación de los Términos',
                    p: [
                        'Al registrarte, iniciar sesión o usar el Servicio declaras que has leído, entendido y aceptado estos Términos y la Política de Cookies. Si no estás de acuerdo con alguna parte, no uses el Servicio.',
                        'Puedes ver el Servicio sin cuenta (por ejemplo, mirar directos), pero algunas funciones requieren registrarse. También en ese caso se aplican estos Términos mientras uses el Servicio.',
                    ],
                },
                {
                    h: 'Qué es Yeli',
                    p: ['Yeli permite a las personas transmitir en directo, ver transmisiones, chatear, seguir canales, guardar y editar sus directos, publicar videos, Shorts e imágenes de su galería, y apoyar a los streamers con Yelis y stickers. Podemos añadir, cambiar o quitar funciones en cualquier momento.'],
                },
                {
                    h: 'Quién puede usar Yeli',
                    ul: [
                        'Debes tener al menos 13 años. Si eres menor de edad según las leyes de tu país, necesitas el permiso de tu madre, padre o tutor legal, que también acepta estos Términos en tu nombre.',
                        'Debes tener capacidad legal para aceptar estos Términos y no tener prohibido usar el Servicio según la ley aplicable.',
                        'Si usas Yeli en nombre de una organización, declaras que puedes obligarla a estos Términos.',
                    ],
                },
                {
                    h: 'Tu cuenta',
                    ul: [
                        'Debes dar un correo electrónico válido y elegir un nombre de usuario (3 a 20 letras, números o guiones bajos). No puedes usar un nombre que suplante a otra persona, marca u organización, ni uno ofensivo.',
                        'Eres responsable de tu contraseña y de todo lo que ocurra en tu cuenta. Avísanos por Soporte si crees que alguien entró sin permiso.',
                        'Tu clave de transmisión es personal: no la compartas. Quien la tenga puede transmitir en tu canal.',
                        'No puedes vender, alquilar ni transferir tu cuenta. Una persona no debe crear varias cuentas para obtener ventajas (por ejemplo, puntos gratis, recompensas o votos) ni para evadir una sanción.',
                    ],
                },
                {
                    h: 'Reglas de conducta',
                    p: ['Al usar Yeli te comprometes a no hacer, transmitir, publicar ni escribir en el chat nada de lo siguiente:'],
                    ul: [
                        'Contenido ilegal o que promueva actividades ilegales.',
                        'Contenido sexual que involucre a menores, o cualquier contenido que los ponga en riesgo. Es tolerancia cero y lo denunciaremos a las autoridades cuando corresponda.',
                        'Pornografía o desnudos explícitos, violencia gráfica gratuita, o contenido que incite al suicidio, la autolesión o los trastornos alimentarios.',
                        'Acoso, amenazas, intimidación, discurso de odio o discriminación por origen, raza, religión, género, orientación sexual, discapacidad u otra condición.',
                        'Publicar datos personales de otras personas sin su permiso (doxxing) o grabar a terceros sin su consentimiento cuando la ley lo exija.',
                        'Suplantar a otra persona, canal o a Yeli, o fingir una relación con ellos.',
                        'Spam, estafas, phishing, publicidad engañosa, enlaces maliciosos o virus.',
                        'Inflar artificialmente espectadores, seguidores, Me gusta, comentarios o donaciones (bots, cuentas falsas, intercambios de Yelis para aparentar actividad).',
                        'Intentar acceder sin permiso a cuentas, sistemas o datos; sobrecargar el Servicio; extraer datos de forma masiva (scraping) o saltarse las medidas de seguridad, de límite de uso o de protección de los videos.',
                        'Evadir un bloqueo, una expulsión del chat o una suspensión creando otra cuenta.',
                    ],
                },
                {
                    h: 'Tu contenido y la licencia que nos das',
                    p: [
                        'Tu contenido (transmisiones, grabaciones, videos, Shorts, imágenes, avatar, biografía, mensajes de chat, comentarios, etc.) sigue siendo tuyo. Eres el único responsable de él y de tener todos los derechos y permisos necesarios para publicarlo.',
                        'Para poder prestar el Servicio nos concedes una licencia mundial, no exclusiva, gratuita y sublicenciable solo a nuestros proveedores técnicos, para alojar, almacenar, reproducir, transmitir, adaptar técnicamente (por ejemplo, convertir formatos o crear miniaturas) y mostrar tu contenido dentro de Yeli y según la visibilidad que elijas (público o solo seguidores). Esta licencia termina cuando eliminas el contenido o tu cuenta, salvo copias técnicas de respaldo que se borran en un plazo razonable y contenido que otras personas ya hayan compartido o citado, como mensajes de chat visibles en grabaciones de otros.',
                        'No usaremos tu contenido para anunciarlo como si fuera nuestro ni lo venderemos a terceros.',
                    ],
                },
                {
                    h: 'Derechos de autor y música',
                    p: [
                        'Solo transmite o publica lo que tengas derecho a mostrar. Eso incluye música, películas, series, partidas de juegos y cualquier obra de otras personas: si no tienes licencia o permiso, no la uses.',
                        'Si crees que algo en Yeli infringe tus derechos, escríbenos desde Soporte indicando qué contenido es, dónde está, que eres el titular o su representante y cómo contactarte. Podremos retirar el contenido mientras lo revisamos y suspender las cuentas que infrinjan derechos de forma repetida.',
                    ],
                },
                {
                    h: 'Directos, grabaciones, editor, Shorts y Galería',
                    ul: [
                        'Tus directos pueden guardarse como videos en tu canal. Puedes elegir si cada video es público, solo para seguidores o privado.',
                        'El editor de video está pensado para trabajar con tus propios directos: un video editado debe contener al menos el porcentaje mínimo de material de tus directos que Yeli indique en el editor (70 % por defecto). El servidor vuelve a calcularlo al exportar.',
                        'Los videos no se pueden descargar desde Yeli y su reproducción está limitada a la propia web. No intentes saltarte esas medidas. Esto no impide, ni podemos evitar, que alguien grabe su pantalla: por eso no publiques nada que no quieras que otros vean.',
                        'Los Shorts (videos verticales) y las imágenes de la Galería tienen límites de duración, tamaño y cantidad que verás en la aplicación y que podemos cambiar.',
                        'Hay límites de almacenamiento por canal. Podemos eliminar contenido antiguo o inactivo cuando sea necesario para mantener el Servicio, avisando con antelación razonable cuando sea posible.',
                        'En servidores de demostración o de prueba, los datos (cuentas, Yelis, chats, videos) pueden reiniciarse en cualquier momento. La aplicación lo indica con un aviso.',
                    ],
                },
                {
                    h: 'Chat, moderación y bot',
                    ul: [
                        'Cada streamer es responsable del chat de su canal: puede nombrar moderadores, bloquear personas, borrar mensajes y configurar su bot, comandos, alertas y lectura de mensajes en voz alta (TTS).',
                        'Los administradores de Yeli pueden moderar cualquier canal y chat, borrar contenido y suspender cuentas que incumplan estos Términos.',
                        'Los mensajes de chat son públicos para quienes ven el canal y pueden quedar visibles en grabaciones. Escribe solo lo que estés dispuesto a mostrar.',
                        'Un bloqueo en un chat no se puede evadir con otra cuenta.',
                    ],
                },
                {
                    h: 'Yelis (moneda virtual)',
                    ul: [
                        'Los Yelis son una moneda virtual del Servicio. Se compran con dinero real en los paquetes disponibles y se usan para enviar apoyo a streamers, comprar stickers premium y obtener puntos de mejora.',
                        'Los Yelis no son dinero, no devengan intereses y no tienen valor fuera de Yeli. Los Yelis que compras no se pueden retirar ni cambiar por dinero; solo los Yelis que recibes como donación pueden solicitarse como retiro, según la sección siguiente.',
                        'Las compras y los envíos de Yelis son definitivos: no se pueden revertir, salvo que la ley aplicable te dé un derecho de desistimiento o reembolso que no pueda excluirse, o que Yeli decida hacerlo por un error técnico demostrable.',
                        'No puedes comprar, vender ni intercambiar Yelis fuera de Yeli. Tampoco puedes usar medios de pago que no te pertenezcan. Si detectamos fraude, contracargos abusivos o uso indebido, podremos anular las compras, retirar los Yelis afectados y suspender la cuenta.',
                        'Mientras el Servicio funcione en modo de pruebas («sandbox»), los pagos son simulados, los Yelis son dinero de juguete y no se puede retirar nada.',
                        'Los precios mostrados incluyen los impuestos aplicables, cuando corresponda.',
                    ],
                },
                {
                    h: 'Retiros y pagos a streamers',
                    ul: [
                        'Los Yelis que un streamer recibe como donación pueden convertirse en dinero con una tasa que depende de su nivel de Ganancias (se muestra en Billetera y Mejoras). Hay un mínimo de Yelis para retirar y las donaciones nuevas quedan retenidas unos días antes de poder retirarse; ambos valores se muestran en la aplicación.',
                        'Cada solicitud de retiro la revisa un administrador. Puede aprobarla, marcarla como pagada o rechazarla; si se rechaza, los Yelis vuelven a tu billetera. Podemos pedirte datos adicionales y retrasar o denegar un retiro si sospechamos fraude, abuso o incumplimiento de estos Términos.',
                        'Debes indicar un método y un destino de pago correctos y que te pertenezcan. No somos responsables de los pagos enviados a datos erróneos que tú proporcionaste.',
                        'Eres responsable de los impuestos que correspondan a lo que ganas con Yeli. Podemos aplicar las retenciones o comisiones que la ley o el procesador de pagos exijan; se te mostrarán antes de confirmar.',
                    ],
                },
                {
                    h: 'Mejoras, puntos, cofre diario y recompensas',
                    p: [
                        'Las mejoras (color del nombre en el chat, insignia del chat, recomendación de cuenta y nivel de Ganancias), los puntos de mejora, los stickers, las insignias y los premios del cofre diario son elementos virtuales con licencia de uso personal: no tienen valor monetario, no son transferibles y no se reembolsan, salvo lo que la ley no permita excluir.',
                        'Los puntos gratuitos por ver directos y el cofre diario tienen límites y condiciones que podemos ajustar. Si detectamos abuso (por ejemplo, varias cuentas del mismo usuario, tiempo de visualización simulado o automatizado), podremos anular lo obtenido.',
                    ],
                },
                {
                    h: 'Insignias y verificación',
                    p: ['La insignia de verificado y las de administrador o moderador las asigna Yeli o cada canal según corresponda. No implican que Yeli respalde, garantice o se haga responsable de lo que dice o hace esa persona. Podemos quitarlas en cualquier momento.'],
                },
                {
                    h: 'Plataformas y servicios de terceros',
                    p: [
                        'Yeli puede conectarse con otras plataformas (por ejemplo, enviar tu directo a Twitch, Kick, TikTok u otras, o leer el chat de Twitch). Si las usas, también debes cumplir sus términos y políticas; Yeli no es responsable de esos servicios ni de las sanciones que te impongan.',
                        'Para retransmitir guardamos las claves de transmisión que tú configuras. Mantenlas actualizadas y bórralas si ya no las quieres usar.',
                        'Los enlaces a redes sociales y otros sitios que aparecen en Yeli llevan a páginas que no controlamos.',
                    ],
                },
                {
                    h: 'Privacidad y datos personales',
                    p: [
                        'Para prestar el Servicio tratamos los datos que nos das y los que se generan al usarlo: nombre de usuario, correo electrónico, contraseña (guardada cifrada, nunca en texto claro), biografía, avatar, seguidores y canales que sigues, mensajes de chat, comentarios, videos y proyectos, compras, donaciones y retiros, ajustes de notificaciones, dirección IP y datos técnicos del dispositivo para seguridad y para limitar abusos.',
                        'Usamos esos datos para: crear y proteger tu cuenta, mostrar tu canal y tu actividad según tu configuración, procesar pagos y retiros, enviarte notificaciones y correos que hayas permitido, atender Soporte, prevenir fraude y abuso, cumplir la ley y mejorar el Servicio. No vendemos tus datos personales.',
                        'Compartimos datos solo con proveedores que nos ayudan a operar Yeli (alojamiento y base de datos, envío de correo, procesamiento de pagos) y bajo sus obligaciones de confidencialidad, o cuando una autoridad competente lo exija legalmente.',
                        'Tu nombre de usuario, avatar, biografía, canal, videos públicos y mensajes de chat son visibles para otras personas. Tu correo electrónico no es público.',
                        'Puedes pedir acceso, corrección o eliminación de tus datos, o la eliminación de tu cuenta, escribiendo a Soporte. Conservamos los datos mientras tu cuenta exista y después solo lo necesario para cumplir obligaciones legales, contables y de seguridad (por ejemplo, registros de pagos).',
                        'Aplicamos medidas técnicas razonables para proteger tus datos, pero ningún sistema es 100 % seguro. En la Política de Cookies explicamos qué almacenamos en tu navegador.',
                    ],
                },
                {
                    h: 'Notificaciones y comunicaciones',
                    p: ['Te avisaremos dentro de la aplicación (campana) y, si lo permites en Editar perfil → Notificaciones, por correo electrónico: nuevos seguidores, Yelis, comentarios, directos, y respuestas de Soporte. Cada correo incluye un enlace para darte de baja. Podemos enviarte avisos imprescindibles sobre tu cuenta, la seguridad o cambios en estos Términos, aunque hayas desactivado el resto.'],
                },
                {
                    h: 'Soporte',
                    p: ['El canal oficial para ayuda, denuncias, derechos de autor, privacidad y consultas es la sección Soporte (menú de tu foto de perfil → Legal → Soporte): necesitas iniciar sesión para escribir, y recibirás la respuesta como una notificación (y por correo, si lo tienes activado) y podrás verla en la misma sección. Intentamos responder lo antes posible, pero no garantizamos un plazo.'],
                },
                {
                    h: 'Suspensión y cierre de cuentas',
                    ul: [
                        'Puedes dejar de usar Yeli y pedir el cierre de tu cuenta en cualquier momento a través de Soporte.',
                        'Podemos advertir, limitar, suspender o cerrar una cuenta, o eliminar contenido, si incumples estos Términos, si pones en riesgo a otras personas o al Servicio, si lo exige la ley o si la cuenta está inactiva durante mucho tiempo.',
                        'Si cerramos tu cuenta por incumplimiento grave, podremos retener o anular saldos y retiros obtenidos de forma irregular. Los Yelis comprados no se reembolsan por esa causa.',
                        'Las cláusulas que por su naturaleza deban seguir vigentes (propiedad intelectual, limitación de responsabilidad, ley aplicable, etc.) sobreviven al cierre de la cuenta.',
                    ],
                },
                {
                    h: 'Propiedad intelectual de Yeli',
                    p: ['El software, el diseño, la marca, el logotipo y los textos de Yeli pertenecen a Yeli o a sus licenciantes. Te damos un derecho personal, limitado, revocable y no exclusivo para usar el Servicio según estos Términos. No puedes copiar, modificar, descompilar ni crear obras derivadas del Servicio, salvo lo que la ley permita expresamente.'],
                },
                {
                    h: 'Disponibilidad del Servicio',
                    p: ['Hacemos lo posible para que Yeli funcione bien, pero se ofrece «tal cual» y «según disponibilidad». Puede haber interrupciones por mantenimiento, fallos, conexión o causas ajenas a nosotros (por ejemplo, el primer acceso tras un periodo de inactividad puede tardar más). Las transmisiones en vivo dependen de tu conexión y dispositivo, y de servicios de terceros. No garantizamos que el Servicio sea ininterrumpido ni libre de errores.'],
                },
                {
                    h: 'Limitación de responsabilidad',
                    p: [
                        'En la máxima medida que permita la ley, Yeli y quienes trabajan en él no serán responsables por daños indirectos, incidentales, especiales, consecuentes o punitivos, ni por pérdida de beneficios, ingresos, datos, audiencia o reputación derivados del uso del Servicio o de la imposibilidad de usarlo, ni por el contenido o la conducta de otros usuarios.',
                        'Si a pesar de lo anterior se determinara que somos responsables, nuestra responsabilidad total frente a ti se limita al mayor de estos importes: lo que hayas pagado a Yeli en los 12 meses anteriores al hecho, o 100 USD.',
                        'Nada en estos Términos excluye ni limita la responsabilidad que no pueda excluirse según la ley aplicable, incluidos los derechos irrenunciables de las personas consumidoras.',
                    ],
                },
                {
                    h: 'Indemnidad',
                    p: ['Aceptas mantener indemne a Yeli frente a reclamaciones de terceros, y a los gastos razonables que de ellas se deriven, causadas por tu contenido, por tu uso del Servicio o por tu incumplimiento de estos Términos o de la ley, en la medida que la ley lo permita.'],
                },
                {
                    h: 'Cambios en los Términos',
                    p: ['Podemos actualizar estos Términos y la Política de Cookies. Indicaremos la fecha de la última actualización arriba y, si el cambio es importante, lo avisaremos en Novedades y/o con una notificación. Los cambios se aplican desde su publicación; si sigues usando el Servicio o inicias sesión después de un cambio, lo aceptas. Si no estás de acuerdo, deja de usarlo y pide cerrar tu cuenta.'],
                },
                {
                    h: 'Ley aplicable y conflictos',
                    p: [
                        'Estos Términos se rigen por las leyes aplicables en el lugar donde Yeli tenga su domicilio legal, sin tener en cuenta sus normas sobre conflicto de leyes. Intentaremos resolver cualquier problema primero de forma amistosa a través de Soporte.',
                        'Si no es posible, las controversias se someterán a los tribunales competentes de ese lugar, sin perjuicio de los derechos que la ley otorgue a las personas consumidoras para acudir a los tribunales de su domicilio.',
                    ],
                },
                {
                    h: 'Disposiciones generales',
                    ul: [
                        'Si una parte de estos Términos se declara inválida, el resto sigue vigente.',
                        'Que no exijamos el cumplimiento de un derecho en un momento dado no significa que renunciemos a él.',
                        'No puedes ceder estos Términos sin nuestro permiso; nosotros sí podemos cederlos en caso de reorganización o traspaso del Servicio.',
                        'Estos Términos, junto con la Política de Cookies, son el acuerdo completo entre tú y Yeli sobre el uso del Servicio. Se ofrecen en español y en inglés; si hubiera diferencias, prevalece la versión en español.',
                    ],
                },
                {
                    h: 'Contacto',
                    p: ['Para cualquier duda sobre estos Términos, escríbenos desde la sección Soporte (menú de tu foto de perfil → Legal → Soporte).'],
                },
            ],
        },
        en: {
            title: 'Terms and Conditions',
            updated: 'Last updated: November 7, 2026',
            intro: [
                'These Terms and Conditions (the “Terms”) govern your use of Yeli, a streaming platform with accounts, chat, followers, a broadcast studio, a video editor and an economy of virtual coins called Yelis (the “Service”). Please read them carefully: by creating an account or logging in you accept these Terms and the Cookies Policy.',
            ],
            sections: [
                {
                    h: 'Acceptance of the Terms',
                    p: [
                        'By signing up, logging in or using the Service you state that you have read, understood and accepted these Terms and the Cookies Policy. If you do not agree with any part, do not use the Service.',
                        'You can browse the Service without an account (for example, to watch streams), but some features require signing up. These Terms apply to you in that case too, for as long as you use the Service.',
                    ],
                },
                {
                    h: 'What Yeli is',
                    p: ['Yeli lets people broadcast live, watch streams, chat, follow channels, save and edit their streams, publish videos, Shorts and gallery pictures, and support streamers with Yelis and stickers. We may add, change or remove features at any time.'],
                },
                {
                    h: 'Who can use Yeli',
                    ul: [
                        'You must be at least 13 years old. If you are a minor under the laws of your country, you need the permission of your parent or legal guardian, who also accepts these Terms on your behalf.',
                        'You must have the legal capacity to accept these Terms and must not be barred from using the Service under applicable law.',
                        'If you use Yeli on behalf of an organization, you state that you can bind it to these Terms.',
                    ],
                },
                {
                    h: 'Your account',
                    ul: [
                        'You must provide a valid email address and choose a username (3 to 20 letters, numbers or underscores). You may not use a name that impersonates another person, brand or organization, or one that is offensive.',
                        'You are responsible for your password and for everything that happens in your account. Tell us through Support if you think someone got in without your permission.',
                        'Your stream key is personal: do not share it. Anyone who has it can broadcast on your channel.',
                        'You may not sell, rent or transfer your account. A person must not create several accounts to gain advantages (for example free points, rewards or votes) or to evade a penalty.',
                    ],
                },
                {
                    h: 'Rules of conduct',
                    p: ['When using Yeli you agree not to do, broadcast, publish or write in chat any of the following:'],
                    ul: [
                        'Illegal content, or content that promotes illegal activity.',
                        'Sexual content involving minors, or any content that puts minors at risk. We have zero tolerance and will report it to the authorities where appropriate.',
                        'Pornography or explicit nudity, gratuitous graphic violence, or content that encourages suicide, self-harm or eating disorders.',
                        'Harassment, threats, intimidation, hate speech or discrimination based on origin, race, religion, gender, sexual orientation, disability or any other condition.',
                        'Publishing other people’s personal data without their permission (doxxing), or recording third parties without their consent where the law requires it.',
                        'Impersonating another person, channel or Yeli, or pretending to be affiliated with them.',
                        'Spam, scams, phishing, misleading advertising, malicious links or viruses.',
                        'Artificially inflating viewers, followers, likes, comments or donations (bots, fake accounts, swapping Yelis to fake activity).',
                        'Trying to access accounts, systems or data without permission; overloading the Service; scraping data in bulk; or bypassing security, rate-limit or video-protection measures.',
                        'Evading a ban, a chat timeout or a suspension by creating another account.',
                    ],
                },
                {
                    h: 'Your content and the license you give us',
                    p: [
                        'Your content (streams, recordings, videos, Shorts, pictures, avatar, bio, chat messages, comments, etc.) remains yours. You alone are responsible for it and for having every right and permission needed to publish it.',
                        'So that we can provide the Service you grant us a worldwide, non-exclusive, royalty-free license, sublicensable only to our technical providers, to host, store, play, transmit, technically adapt (for example convert formats or create thumbnails) and display your content within Yeli and according to the visibility you choose (public or followers only). This license ends when you delete the content or your account, except for technical backup copies that are deleted within a reasonable time, and content that other people have already shared or quoted, such as chat messages visible in other people’s recordings.',
                        'We will not present your content as ours or sell it to third parties.',
                    ],
                },
                {
                    h: 'Copyright and music',
                    p: [
                        'Only broadcast or publish what you have the right to show. That includes music, films, series, game footage and any work by other people: if you do not have a license or permission, do not use it.',
                        'If you believe something on Yeli infringes your rights, write to us through Support saying which content it is, where it is, that you are the owner or their representative, and how to reach you. We may remove the content while we review it and suspend accounts that repeatedly infringe rights.',
                    ],
                },
                {
                    h: 'Streams, recordings, editor, Shorts and Gallery',
                    ul: [
                        'Your streams can be saved as videos on your channel. You choose whether each video is public, followers only or private.',
                        'The video editor is meant for working with your own streams: an edited video must contain at least the minimum share of footage from your live streams that Yeli shows in the editor (70% by default). The server recalculates it when you export.',
                        'Videos cannot be downloaded from Yeli and their playback is limited to the site itself. Do not try to bypass those measures. This does not prevent, and we cannot prevent, someone from recording their screen: so do not publish anything you do not want others to see.',
                        'Shorts (vertical videos) and Gallery pictures have limits on length, size and quantity that you will see in the app and that we may change.',
                        'There are storage limits per channel. We may delete old or inactive content when needed to keep the Service running, giving reasonable notice when possible.',
                        'On demo or test servers, data (accounts, Yelis, chats, videos) may be reset at any time. The app shows a notice when that is the case.',
                    ],
                },
                {
                    h: 'Chat, moderation and bot',
                    ul: [
                        'Each streamer is responsible for the chat of their channel: they can appoint moderators, ban people, delete messages and configure their bot, commands, alerts and text-to-speech (TTS).',
                        'Yeli administrators can moderate any channel and chat, delete content and suspend accounts that break these Terms.',
                        'Chat messages are public to people watching the channel and may stay visible in recordings. Only write what you are willing to show.',
                        'A ban in a chat cannot be evaded with another account.',
                    ],
                },
                {
                    h: 'Yelis (virtual currency)',
                    ul: [
                        'Yelis are a virtual currency of the Service. They are bought with real money in the available packs and used to send support to streamers, buy premium stickers and get upgrade points.',
                        'Yelis are not money, earn no interest and have no value outside Yeli. Yelis you buy cannot be cashed out or exchanged for money; only Yelis you receive as donations can be requested as a cash-out, as described in the next section.',
                        'Purchases and Yeli transfers are final: they cannot be reversed, unless applicable law gives you a right of withdrawal or refund that cannot be excluded, or Yeli decides to do so because of a demonstrable technical error.',
                        'You may not buy, sell or trade Yelis outside Yeli. You may not use payment methods that do not belong to you. If we detect fraud, abusive chargebacks or misuse, we may cancel purchases, remove the affected Yelis and suspend the account.',
                        'While the Service runs in test mode (“sandbox”), payments are simulated, Yelis are play money and nothing can be cashed out.',
                        'Prices shown include applicable taxes, where relevant.',
                    ],
                },
                {
                    h: 'Cash-outs and payments to streamers',
                    ul: [
                        'Yelis a streamer receives as donations can be turned into money at a rate that depends on their Earnings level (shown in Wallet and Upgrades). There is a minimum number of Yelis to cash out, and new donations are held for some days before they can be cashed out; both values are shown in the app.',
                        'An administrator reviews every cash-out request. They can approve it, mark it as paid or reject it; if rejected, the Yelis return to your wallet. We may ask for more information and delay or deny a cash-out if we suspect fraud, abuse or a breach of these Terms.',
                        'You must give a correct payment method and destination that belong to you. We are not responsible for payments sent to wrong details that you provided.',
                        'You are responsible for any taxes due on what you earn with Yeli. We may apply the withholdings or fees that the law or the payment processor requires; they will be shown to you before you confirm.',
                    ],
                },
                {
                    h: 'Upgrades, points, daily chest and rewards',
                    p: [
                        'Upgrades (chat name color, chat badge, account recommendation and Earnings level), upgrade points, stickers, badges and daily chest prizes are virtual items licensed for your personal use: they have no monetary value, are not transferable and are not refundable, except where the law does not allow that to be excluded.',
                        'Free points for watching streams and the daily chest have limits and conditions that we may adjust. If we detect abuse (for example several accounts by the same person, or simulated or automated watch time), we may cancel what was obtained.',
                    ],
                },
                {
                    h: 'Badges and verification',
                    p: ['The verified badge and the administrator or moderator badges are assigned by Yeli or by each channel as applicable. They do not mean that Yeli endorses, guarantees or is responsible for what that person says or does. We may remove them at any time.'],
                },
                {
                    h: 'Third-party platforms and services',
                    p: [
                        'Yeli can connect with other platforms (for example, sending your stream to Twitch, Kick, TikTok or others, or reading Twitch chat). If you use them you must also follow their terms and policies; Yeli is not responsible for those services or for any penalties they impose on you.',
                        'To restream we store the stream keys that you configure. Keep them up to date and delete them if you no longer want to use them.',
                        'Links to social networks and other sites that appear in Yeli lead to pages that we do not control.',
                    ],
                },
                {
                    h: 'Privacy and personal data',
                    p: [
                        'To provide the Service we process the data you give us and the data generated when you use it: username, email address, password (stored hashed, never in clear text), bio, avatar, followers and channels you follow, chat messages, comments, videos and projects, purchases, donations and cash-outs, notification settings, IP address and technical device data for security and to limit abuse.',
                        'We use that data to: create and protect your account, show your channel and activity according to your settings, process payments and cash-outs, send you the notifications and emails you allowed, handle Support, prevent fraud and abuse, comply with the law and improve the Service. We do not sell your personal data.',
                        'We share data only with providers that help us run Yeli (hosting and database, email delivery, payment processing) and under their duties of confidentiality, or when a competent authority legally requires it.',
                        'Your username, avatar, bio, channel, public videos and chat messages are visible to other people. Your email address is not public.',
                        'You can ask for access to, correction of or deletion of your data, or deletion of your account, by writing to Support. We keep data while your account exists and afterwards only what is needed to meet legal, accounting and security obligations (for example payment records).',
                        'We apply reasonable technical measures to protect your data, but no system is 100% secure. The Cookies Policy explains what we store in your browser.',
                    ],
                },
                {
                    h: 'Notifications and communications',
                    p: ['We will notify you inside the app (the bell) and, if you allow it in Edit profile → Notifications, by email: new followers, Yelis, comments, live streams and Support replies. Every email includes an unsubscribe link. We may send you essential notices about your account, security or changes to these Terms even if you turned off the rest.'],
                },
                {
                    h: 'Support',
                    p: ['The official channel for help, reports, copyright, privacy and questions is the Support section (profile picture menu → Legal → Support): you need to be logged in to write, and you will receive the answer as a notification (and by email, if you have it on) and can read it in the same section. We try to answer as soon as possible but do not guarantee a deadline.'],
                },
                {
                    h: 'Suspension and closing of accounts',
                    ul: [
                        'You can stop using Yeli and ask to close your account at any time through Support.',
                        'We may warn, limit, suspend or close an account, or delete content, if you break these Terms, put other people or the Service at risk, if the law requires it, or if the account has been inactive for a long time.',
                        'If we close your account for a serious breach, we may withhold or cancel balances and cash-outs obtained irregularly. Purchased Yelis are not refunded for that reason.',
                        'Clauses that by their nature should remain in force (intellectual property, limitation of liability, governing law, etc.) survive the closing of the account.',
                    ],
                },
                {
                    h: 'Yeli’s intellectual property',
                    p: ['The software, design, brand, logo and texts of Yeli belong to Yeli or its licensors. We give you a personal, limited, revocable, non-exclusive right to use the Service under these Terms. You may not copy, modify, decompile or create derivative works of the Service, except as the law expressly allows.'],
                },
                {
                    h: 'Availability of the Service',
                    p: ['We do our best to keep Yeli running well, but it is provided “as is” and “as available”. There may be interruptions for maintenance, failures, connectivity or causes beyond our control (for example, the first visit after a period of inactivity may be slower). Live streams depend on your connection and device and on third-party services. We do not guarantee that the Service will be uninterrupted or error-free.'],
                },
                {
                    h: 'Limitation of liability',
                    p: [
                        'To the fullest extent permitted by law, Yeli and the people who work on it will not be liable for indirect, incidental, special, consequential or punitive damages, or for loss of profits, revenue, data, audience or reputation arising from the use of or the inability to use the Service, or from the content or conduct of other users.',
                        'If despite the above we were found liable, our total liability to you is limited to the greater of: what you paid to Yeli in the 12 months before the event, or 100 USD.',
                        'Nothing in these Terms excludes or limits liability that cannot be excluded under applicable law, including consumers’ non-waivable rights.',
                    ],
                },
                {
                    h: 'Indemnity',
                    p: ['You agree to hold Yeli harmless from third-party claims, and the reasonable costs that follow from them, caused by your content, your use of the Service, or your breach of these Terms or of the law, to the extent the law allows.'],
                },
                {
                    h: 'Changes to the Terms',
                    p: ['We may update these Terms and the Cookies Policy. We will show the date of the last update above and, if the change is important, announce it in What’s new and/or with a notification. Changes apply from the moment they are published; if you keep using the Service or log in after a change, you accept it. If you do not agree, stop using it and ask to close your account.'],
                },
                {
                    h: 'Governing law and disputes',
                    p: [
                        'These Terms are governed by the laws that apply where Yeli has its legal domicile, without regard to its conflict-of-law rules. We will try to resolve any problem amicably through Support first.',
                        'If that is not possible, disputes will be submitted to the competent courts of that place, without prejudice to any rights the law gives consumers to go to the courts of their place of residence.',
                    ],
                },
                {
                    h: 'General provisions',
                    ul: [
                        'If any part of these Terms is declared invalid, the rest remains in force.',
                        'Our not enforcing a right at a given time does not mean we waive it.',
                        'You may not assign these Terms without our permission; we may assign them in case of a reorganization or transfer of the Service.',
                        'These Terms, together with the Cookies Policy, are the entire agreement between you and Yeli about the use of the Service. They are offered in Spanish and English; if there are differences, the Spanish version prevails.',
                    ],
                },
                {
                    h: 'Contact',
                    p: ['For any question about these Terms, write to us from the Support section (profile picture menu → Legal → Support).'],
                },
            ],
        },
    },

    cookies: {
        es: {
            title: 'Política de Cookies',
            updated: 'Última actualización: 7 de noviembre de 2026',
            intro: [
                'Esta política explica qué cookies y qué almacenamiento local usa Yeli, para qué sirven y cómo puedes controlarlos. Forma parte de los Términos y Condiciones: al registrarte o iniciar sesión también la aceptas.',
            ],
            sections: [
                {
                    h: 'Qué son las cookies y el almacenamiento local',
                    p: ['Las cookies son pequeños archivos que un sitio guarda en tu navegador. El almacenamiento local (localStorage) y la caché del navegador cumplen una función parecida: guardan datos en tu dispositivo para que el sitio funcione mejor. En esta política los llamamos, en conjunto, «cookies».'],
                },
                {
                    h: 'Qué usamos',
                    p: ['Yeli solo usa cookies necesarias para que el Servicio funcione y para recordar tus preferencias. No usamos cookies de publicidad, de seguimiento entre sitios ni de analítica de terceros.'],
                    table: {
                        head: ['Nombre', 'Tipo', 'Para qué sirve', 'Duración'],
                        rows: [
                            ['session', 'Cookie esencial (propia)', 'Mantiene tu sesión iniciada y protege tu cuenta. Es HttpOnly (el código de la página no puede leerla), SameSite=Lax y, con HTTPS, Secure.', 'Hasta 30 días o hasta que cierres sesión'],
                            ['yeli.prefs.v1', 'Almacenamiento local (propio)', 'Tus ajustes de apariencia: tema, densidad, barra lateral, animaciones, animación de carga e idioma.', 'Hasta que los borres'],
                            ['yeli:volume, yeli:quality, yeli:chat-hidden', 'Almacenamiento local (propio)', 'Recuerdan el volumen, la calidad de video y si ocultaste el chat en el reproductor.', 'Hasta que los borres'],
                            ['yeli:studio:v2, yeli:tts, yeli:tts:own', 'Almacenamiento local (propio)', 'Guardan la configuración de tu estudio de transmisión y de la lectura de mensajes en voz alta (TTS).', 'Hasta que los borres'],
                            ['Caché de la aplicación (service worker)', 'Caché del navegador (propia)', 'Guarda los archivos de la aplicación para que Yeli abra más rápido, pueda instalarse como app y muestre un aviso si no hay conexión. No guarda tus datos privados.', 'Se renueva con cada actualización'],
                        ],
                    },
                },
                {
                    h: 'Servicios de terceros',
                    ul: [
                        'Tipografías: Yeli carga sus fuentes desde Google Fonts. Al hacerlo, Google recibe tu dirección IP y datos técnicos de tu navegador, según su propia política de privacidad.',
                        'Conexión de video: para conectar tu cámara y las transmisiones entre dispositivos usamos tecnología WebRTC, que puede contactar con servidores de ayuda a la conexión (STUN/TURN). Estos servidores ven tu dirección IP para poder establecer la conexión.',
                        'Enlaces externos: las redes sociales y otros sitios enlazados en Yeli tienen sus propias cookies y políticas. Yeli no las controla.',
                    ],
                },
                {
                    h: 'Por qué no te pedimos elegir',
                    p: ['Las cookies que usamos son estrictamente necesarias para prestar el Servicio que pides (mantener tu sesión, recordar tus ajustes) o son preferencias que tú controlas. Por eso las aceptas junto con los Términos al registrarte o iniciar sesión. Si algún día añadimos cookies no esenciales (por ejemplo, de analítica o publicidad), te pediremos permiso de forma separada y actualizaremos esta política.'],
                },
                {
                    h: 'Cómo controlarlas',
                    ul: [
                        'Puedes borrar las cookies y los datos del sitio, o bloquearlas, desde los ajustes de tu navegador. Si bloqueas la cookie «session», no podrás mantener la sesión iniciada. Si borras el almacenamiento local, perderás tus ajustes de apariencia y del estudio y tendrás que configurarlos de nuevo.',
                        'En Ajustes → Restablecer puedes volver a los ajustes de apariencia por defecto.',
                        'Al cerrar sesión, la cookie de sesión se elimina de tu navegador.',
                    ],
                },
                {
                    h: 'Cambios en esta política',
                    p: ['Si cambiamos las cookies que usamos, actualizaremos esta página y la fecha de arriba. Los cambios importantes se avisarán en Novedades.'],
                },
                {
                    h: 'Contacto',
                    p: ['Si tienes preguntas sobre esta política, escríbenos desde la sección Soporte (menú de tu foto de perfil → Legal → Soporte).'],
                },
            ],
        },
        en: {
            title: 'Cookies Policy',
            updated: 'Last updated: November 7, 2026',
            intro: [
                'This policy explains which cookies and local storage Yeli uses, what they are for and how you can control them. It is part of the Terms and Conditions: by signing up or logging in you also accept it.',
            ],
            sections: [
                {
                    h: 'What cookies and local storage are',
                    p: ['Cookies are small files that a site saves in your browser. Local storage (localStorage) and the browser cache do a similar job: they keep data on your device so the site works better. In this policy we call them all “cookies”.'],
                },
                {
                    h: 'What we use',
                    p: ['Yeli only uses cookies that are necessary for the Service to work and to remember your preferences. We do not use advertising cookies, cross-site tracking or third-party analytics.'],
                    table: {
                        head: ['Name', 'Type', 'What it is for', 'Duration'],
                        rows: [
                            ['session', 'Essential cookie (first-party)', 'Keeps you logged in and protects your account. It is HttpOnly (page code cannot read it), SameSite=Lax and, on HTTPS, Secure.', 'Up to 30 days or until you log out'],
                            ['yeli.prefs.v1', 'Local storage (first-party)', 'Your appearance settings: theme, density, sidebar, animations, loading animation and language.', 'Until you delete them'],
                            ['yeli:volume, yeli:quality, yeli:chat-hidden', 'Local storage (first-party)', 'Remember the volume, video quality and whether you hid the chat in the player.', 'Until you delete them'],
                            ['yeli:studio:v2, yeli:tts, yeli:tts:own', 'Local storage (first-party)', 'Save your broadcast studio setup and your text-to-speech (TTS) settings.', 'Until you delete them'],
                            ['App cache (service worker)', 'Browser cache (first-party)', 'Stores the app files so Yeli opens faster, can be installed as an app and shows a notice when you are offline. It does not store your private data.', 'Renewed with every update'],
                        ],
                    },
                },
                {
                    h: 'Third-party services',
                    ul: [
                        'Fonts: Yeli loads its fonts from Google Fonts. When it does, Google receives your IP address and technical data about your browser, under its own privacy policy.',
                        'Video connection: to connect your camera and streams between devices we use WebRTC technology, which may contact connection-assist servers (STUN/TURN). These servers see your IP address in order to set up the connection.',
                        'External links: the social networks and other sites linked in Yeli have their own cookies and policies. Yeli does not control them.',
                    ],
                },
                {
                    h: 'Why we do not ask you to choose',
                    p: ['The cookies we use are strictly necessary to provide the Service you ask for (keeping you logged in, remembering your settings) or are preferences that you control. That is why you accept them together with the Terms when you sign up or log in. If we ever add non-essential cookies (for example analytics or advertising), we will ask for your permission separately and update this policy.'],
                },
                {
                    h: 'How to control them',
                    ul: [
                        'You can delete cookies and site data, or block them, in your browser settings. If you block the “session” cookie you will not be able to stay logged in. If you delete local storage you will lose your appearance and studio settings and have to set them up again.',
                        'In Settings → Reset you can go back to the default appearance settings.',
                        'When you log out, the session cookie is removed from your browser.',
                    ],
                },
                {
                    h: 'Changes to this policy',
                    p: ['If we change the cookies we use, we will update this page and the date above. Important changes will be announced in What’s new.'],
                },
                {
                    h: 'Contact',
                    p: ['If you have questions about this policy, write to us from the Support section (profile picture menu → Legal → Support).'],
                },
            ],
        },
    },

    about: {
        es: {
            title: 'Quiénes somos',
            updated: '',
            intro: [
                'Yeli es una plataforma de streaming para ver y hacer directos. Queremos que cualquiera pueda transmitir lo que le gusta, encontrar a su comunidad y apoyar a los creadores que sigue, sin complicaciones técnicas.',
            ],
            sections: [
                {
                    h: 'Qué puedes hacer en Yeli',
                    ul: [
                        'Ver directos de cualquier categoría, seguir canales y recibir un aviso cuando empiezan.',
                        'Chatear con stickers y reaccionar a lo que pasa en el directo.',
                        'Transmitir desde tu navegador con un estudio al estilo OBS, con escenas, alertas y un bot de chat; o enviar tu directo a otras plataformas a la vez.',
                        'Guardar tus directos, recortarlos en el editor de video, y publicar videos, Shorts e imágenes de tu galería.',
                        'Apoyar a los streamers con Yelis, nuestra moneda virtual, y retirar lo que recibes como donaciones.',
                        'Moderar tu canal con moderadores, bloqueos y comandos propios.',
                    ],
                },
                {
                    h: 'Cómo pensamos Yeli',
                    ul: [
                        'Directos primero: el editor pide que un video editado se base en tus propios directos (70 % por defecto), para que el contenido siga siendo auténtico.',
                        'Reglas claras: los Términos y Condiciones y la Política de Cookies están completos y a un clic, en el menú de tu perfil → Legal.',
                        'Privacidad razonable: solo cookies necesarias, sin publicidad ni rastreo entre sitios, y tu correo nunca es público.',
                        'Cuentas protegidas: contraseñas cifradas, protección contra intentos de acceso repetidos y videos que no se pueden descargar desde la web.',
                    ],
                },
                {
                    h: 'Habla con nosotros',
                    p: [
                        'Si tienes una pregunta, un problema, una idea o quieres denunciar algo, escríbenos desde Soporte: respondemos por notificación y puedes seguir la conversación allí mismo. Para saber qué estamos mejorando, mira las Novedades; y para seguirnos, usa nuestras redes sociales.',
                    ],
                },
            ],
        },
        en: {
            title: 'About us',
            updated: '',
            intro: [
                'Yeli is a streaming platform for watching and making live streams. We want anyone to be able to broadcast what they love, find their community and support the creators they follow, without technical hassle.',
            ],
            sections: [
                {
                    h: 'What you can do on Yeli',
                    ul: [
                        'Watch live streams in any category, follow channels and get a heads-up when they start.',
                        'Chat with stickers and react to what happens on the stream.',
                        'Broadcast from your browser with an OBS-style studio, with scenes, alerts and a chat bot; or send your stream to other platforms at the same time.',
                        'Save your streams, trim them in the video editor, and publish videos, Shorts and pictures from your gallery.',
                        'Support streamers with Yelis, our virtual currency, and cash out what you receive as donations.',
                        'Moderate your channel with moderators, bans and your own commands.',
                    ],
                },
                {
                    h: 'How we think about Yeli',
                    ul: [
                        'Live first: the editor asks that an edited video be based on your own streams (70% by default), so content stays authentic.',
                        'Clear rules: the Terms and Conditions and the Cookies Policy are complete and one click away, in your profile menu → Legal.',
                        'Reasonable privacy: only necessary cookies, no advertising or cross-site tracking, and your email is never public.',
                        'Protected accounts: hashed passwords, protection against repeated login attempts, and videos that cannot be downloaded from the website.',
                    ],
                },
                {
                    h: 'Talk to us',
                    p: [
                        'If you have a question, a problem, an idea or want to report something, write to us from Support: we answer by notification and you can follow the conversation right there. To see what we are improving, check What’s new; and to follow us, use our social networks.',
                    ],
                },
            ],
        },
    },
};
