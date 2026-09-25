import { FaceLandmarker, HandLandmarker, PoseLandmarker } from './node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';
export const features = [
    { id: 'body', label: 'Body & arms', color: '#ffd76a' },
    { id: 'face', label: 'Face & nose', color: '#a4dfc5' },
    { id: 'eyes', label: 'Eyes & eyebrows', color: '#8dccff' },
    { id: 'mouth', label: 'Mouth', color: '#ff9da9' },
    { id: 'hands', label: 'Hands & fingers', color: '#d5b2ff' },
];
export const emptyFrame = { body: [], face: [], hands: [], expressions: {} };
export const fingerColors = ['#ffd76a', '#a4dfc5', '#8dccff', '#ff9da9', '#d5b2ff'];
export function visiblePoint(point, minVisibility = 0) {
    return Number.isFinite(point.x) && Number.isFinite(point.y) &&
        point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1 &&
        (point.visibility ?? 1) >= minVisibility;
}
// Both views use the same mirrored coordinates, without cropping the camera image.
export function drawMotion(canvas, frame, selected, width, height, detail) {
    const context = canvas.getContext('2d');
    if (!context)
        return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const hand = frame.hands.find(({ side }) => side === detail)?.points ?? [];
    const cropPoints = detail === 'face' ? frame.face : hand;
    let scale = canvas.width / width;
    let offsetX = 0;
    let offsetY = 0;
    if (detail) {
        const points = cropPoints.filter((point) => visiblePoint(point));
        if (!points.length)
            return;
        const xs = points.map(({ x }) => (1 - x) * width);
        const ys = points.map(({ y }) => y * height);
        const left = Math.min(...xs), right = Math.max(...xs);
        const top = Math.min(...ys), bottom = Math.max(...ys);
        scale = Math.min((canvas.width - 48) / Math.max(right - left, 1), (canvas.height - 48) / Math.max(bottom - top, 1));
        offsetX = canvas.width / 2 - (left + right) / 2 * scale;
        offsetY = canvas.height / 2 - (top + bottom) / 2 * scale;
    }
    const position = (point) => ({
        x: (1 - point.x) * width * scale + offsetX,
        y: point.y * height * scale + offsetY,
    });
    function draw(points, connections, color, radius = 2) {
        if (!context)
            return;
        context.strokeStyle = color;
        context.fillStyle = color;
        context.lineWidth = detail ? 2 : 2.5;
        context.lineCap = 'round';
        context.beginPath();
        const indices = new Set();
        // Face and hand models leave visibility at zero; only pose provides this score.
        const minVisibility = points === frame.body ? 0.5 : 0;
        for (const { start, end } of connections) {
            indices.add(start);
            indices.add(end);
            if (!points[start] || !points[end] || !visiblePoint(points[start], minVisibility) || !visiblePoint(points[end], minVisibility))
                continue;
            const a = position(points[start]), b = position(points[end]);
            context.moveTo(a.x, a.y);
            context.lineTo(b.x, b.y);
        }
        context.stroke();
        for (const index of indices) {
            const point = points[index];
            if (!point || !visiblePoint(point, minVisibility))
                continue;
            const { x, y } = position(point);
            context.beginPath();
            context.arc(x, y, radius, 0, Math.PI * 2);
            context.fill();
        }
    }
    if (!detail && selected.body)
        draw(frame.body, PoseLandmarker.POSE_CONNECTIONS.filter(({ start, end }) => start >= 11 && end >= 11 && ![17, 18, 19, 20, 21, 22].includes(start) && ![17, 18, 19, 20, 21, 22].includes(end)), features[0].color, 4);
    if (!detail || detail === 'face') {
        if (selected.face) {
            draw(frame.face, FaceLandmarker.FACE_LANDMARKS_TESSELATION, '#a4dfc530', 0.6);
            draw(frame.face, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, features[1].color);
            draw(frame.face, [{ start: 168, end: 6 }, { start: 6, end: 1 }, { start: 1, end: 2 }], features[1].color);
        }
        if (selected.eyes)
            draw(frame.face, [
                ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
                ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
                ...FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, ...FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
            ], features[2].color);
        if (selected.mouth)
            draw(frame.face, FaceLandmarker.FACE_LANDMARKS_LIPS, features[3].color);
    }
    if (selected.hands && detail !== 'face') {
        for (const points of detail ? [hand] : frame.hands.map(({ points }) => points)) {
            draw(points, HandLandmarker.HAND_CONNECTIONS, features[4].color, 3);
            for (let finger = 0; finger < 5; finger++) {
                const first = finger * 4 + 1;
                draw(points, [
                    { start: 0, end: first }, { start: first, end: first + 1 },
                    { start: first + 1, end: first + 2 }, { start: first + 2, end: first + 3 },
                ], fingerColors[finger], 3);
            }
        }
    }
}

export { FaceLandmarker, HandLandmarker, PoseLandmarker };
export { FilesetResolver } from './node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';
