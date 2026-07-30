# SPECTRA - Chrome Web Store (Español)

## Nombre

SPECTRA - Volumen, Ecualizador y Control Multimedia

## Resumen (máx. 132 caracteres)

Hasta 800 % de volumen, ecualizador de 10 bandas, controles multimedia y un mando móvil autenticado opcional.

## Descripción detallada

SPECTRA reúne controles de audio, reproducción y vídeo en una extensión de Chrome. La configuración y el procesamiento multimedia permanecen en el dispositivo de forma predeterminada.

### Audio

- Control de volumen de hasta 800 %
- Ecualizador de 10 bandas, de 32 Hz a 16 kHz
- Graves, compresor, mono, balance estéreo y retardo
- Silencio del medio y del tabulador del navegador como estados independientes

Una amplificación alta puede causar distorsión o niveles de escucha inseguros. Aumenta el volumen de forma gradual y utiliza el compresor según la fuente y el equipo de reproducción.

### Reproducción y vídeo

- Velocidad, reproducción/pausa, búsqueda, bucles, marcadores y bucle A/B
- Rotación, espejo, relleno, filtros y atenuación del fondo
- Imagen en imagen y pantalla completa mediante las funciones estándar del navegador
- Capturas del fotograma visible cuando la página y el medio permiten la captura

La disponibilidad depende de la página, el elemento multimedia, la compatibilidad del navegador, los permisos y la activación del usuario. SPECTRA informa de las operaciones no compatibles en lugar de prometer el mismo resultado en todos los sitios web.

### Mando móvil opcional

Crea una sesión de emparejamiento y escanea el código QR. El dispositivo de control debe completar una autenticación HMAC-SHA-256 antes de recibir el estado o enviar órdenes.

El mando está desactivado de forma predeterminada. Al activarlo, utiliza Cloudflare Pages, señalización de PeerJS y servicios STUN/TURN. Después de la autenticación, el título, el dominio y el estado de control multimedia del tabulador seleccionado pueden intercambiarse con el dispositivo emparejado. El canal remoto no envía el contenido de la página, favicons, audio ni vídeo.

### Ajustes y atajos

- Preferencias locales globales y por sitio
- Atajos multimedia configurables
- Interfaz traducida
- Estado real confirmado compartido por el Popup y el mando autenticado

### Privacidad

SPECTRA no contiene publicidad, análisis, telemetría ni un servicio de recopilación operado por el desarrollador. Los ajustes y el procesamiento permanecen locales de forma predeterminada. La red opcional del mando se describe aquí y en la política de privacidad.

SPECTRA no elude la seguridad del navegador, los permisos, las restricciones de contenido protegido ni los requisitos de activación del usuario.