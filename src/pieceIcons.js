import * as THREE from 'three';

/**
 * ÍCONES DAS PEÇAS
 *
 * Cada peça ganha um "selo" redondo no chão, embaixo dela, com o símbolo do tipo
 * (peão, torre, cavalo, bispo, rainha, rei). Na Visão 2D (câmera em cima) os selos
 * são desenhados por cima dos modelos 3D, funcionando como um tabuleiro comum.
 *
 * Os arquivos ficam em:  public/assets/piece-icons/<white|black>/<peça>.svg
 * Para trocar um ícone, substitua o arquivo MANTENDO O MESMO NOME.
 * (Se quiser usar PNG, troque a extensão em PIECE_ICON_EXTENSION abaixo.)
 */
export const PIECE_ICON_DIR = `${import.meta.env.BASE_URL}assets/piece-icons`;
export const PIECE_ICON_EXTENSION = 'svg';
export const PIECE_ICON_COLOR_DIRS = { w: 'white', b: 'black' };
export const PIECE_ICON_TYPES = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];

export function pieceIconUrl(type, color) {
  return `${PIECE_ICON_DIR}/${PIECE_ICON_COLOR_DIRS[color]}/${type}.${PIECE_ICON_EXTENSION}`;
}

const TEXTURE_SIZE = 256;
const ICON_SIZE_RATIO = 0.84; // diâmetro do selo em relação à casa do tabuleiro
const ICON_LIFT = 0.004; // altura acima do tabuleiro (m) para não "brigar" com o chão
const FALLBACK_LETTERS = { pawn: 'P', rook: 'T', knight: 'C', bishop: 'B', queen: 'D', king: 'R' };

export function createPieceIconSystem({ squareSize, maxAnisotropy = 1 }) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  /** @type {Map<string, THREE.MeshBasicMaterial>} */
  const materials = new Map();
  let overlay = false;

  // Enquanto a imagem carrega (ou se o arquivo não existir), desenha uma letra
  function drawFallback(ctx, type, color) {
    const s = TEXTURE_SIZE;
    ctx.clearRect(0, 0, s, s);
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2);
    ctx.fillStyle = color === 'w' ? '#f3ead8' : '#1d1a17';
    ctx.fill();
    ctx.lineWidth = s * 0.04;
    ctx.strokeStyle = '#c9a43a';
    ctx.stroke();
    ctx.fillStyle = color === 'w' ? '#2a2118' : '#efe3c8';
    ctx.font = `bold ${s * 0.5}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(FALLBACK_LETTERS[type] || '?', s / 2, s / 2 + s * 0.03);
  }

  function getMaterial(type, color) {
    const key = `${type}_${color}`;
    if (materials.has(key)) return materials.get(key);

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TEXTURE_SIZE;
    const ctx = canvas.getContext('2d');
    drawFallback(ctx, type, color);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAnisotropy;

    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
      ctx.drawImage(img, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
      texture.needsUpdate = true;
    };
    img.onerror = () => console.warn(`[icons] não foi possível carregar ${img.src}`);
    img.src = pieceIconUrl(type, color);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: !overlay,
      toneMapped: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    materials.set(key, material);
    return material;
  }

  /**
   * Cria o selo de uma peça. Ele é adicionado como filho do modelo 3D da peça,
   * por isso recebe a escala do modelo para compensar e manter o tamanho real.
   */
  function createIcon(type, color, parentScale = 1) {
    const pivot = new THREE.Group();
    pivot.name = 'pieceIconPivot';
    pivot.position.y = ICON_LIFT / parentScale;

    const mesh = new THREE.Mesh(geometry, getMaterial(type, color));
    mesh.name = 'pieceIcon';
    mesh.rotation.x = -Math.PI / 2; // deita o plano no chão
    mesh.scale.setScalar((squareSize * ICON_SIZE_RATIO) / parentScale);
    mesh.renderOrder = 10; // desenhado depois dos modelos (importa na Visão 2D)
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    pivot.add(mesh);
    return pivot;
  }

  /** Visão 2D: ícones aparecem por cima dos modelos 3D. */
  function setOverlayMode(on) {
    if (overlay === on) return;
    overlay = on;
    for (const material of materials.values()) {
      material.depthTest = !on;
    }
  }

  /**
   * Gira o selo para ficar "de pé" para o observador, cancelando a rotação do modelo
   * (as peças viram de lado ao andar). viewYaw = direção horizontal da câmera.
   */
  function orient(piece, viewYaw) {
    if (piece.iconPivot && piece.mesh) {
      piece.iconPivot.rotation.y = viewYaw - piece.mesh.rotation.y;
    }
  }

  return { createIcon, setOverlayMode, isOverlay: () => overlay, orient };
}
