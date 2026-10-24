import { useEffect, useRef, useState } from "react";
import { bestPortrait, MIN_AUTO_PORTRAITS } from "../core/score";
import type { Speaker } from "../core/types";
import { Avatar } from "./common";

interface Props {
  speaker: Speaker | null;
  others: Speaker[];
  onClose: () => void;
  onSave: (id: number, name: string, photo: string | undefined) => void;
  onMerge: (from: number, into: number) => void;
}

const MAX_PHOTO_BYTES = 4_000_000;

export function SpeakerDialog({ speaker, others, onClose, onSave, onMerge }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState<string | undefined>();
  const [mergeInto, setMergeInto] = useState("");
  const [warn, setWarn] = useState("");

  useEffect(() => {
    if (speaker) {
      setName(speaker.name);
      setPhoto(speaker.photo);
      setMergeInto("");
      setWarn("");
      ref.current?.showModal();
    } else ref.current?.close();
  }, [speaker]);

  if (!speaker) return <dialog ref={ref} />;
  const preview: Speaker = { ...speaker, name: name || speaker.name, photo };
  const auto = bestPortrait(speaker.portraits);

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (f.size > MAX_PHOTO_BYTES) return setWarn("Foto acima de 4 MB; escolha uma menor.");
    const r = new FileReader();
    r.onload = () => setPhoto(String(r.result));
    r.readAsDataURL(f);
  }

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="spk-title">
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); onSave(speaker.id, name, photo); onClose(); }}>
        <h3 id="spk-title">Falante · voz #{speaker.id + 1}</h3>
        <div className="spk-form">
          <Avatar speaker={preview} size="xl" />
          <div className="stack">
            <label>Nome<input id="spk-name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label>Foto do computador<input id="spk-photo" type="file" accept="image/*" onChange={(e) => pickFile(e.target.files?.[0])} /></label>
            {warn && <p className="hint err">{warn}</p>}
          </div>
        </div>
        <fieldset className="portraits">
          <legend>Fotos capturadas do vídeo ({speaker.portraits.length})</legend>
          {!speaker.portraits.length && <p className="hint">Nenhuma ainda. Elas aparecem quando a câmera mostra um rosto durante a fala desta voz.</p>}
          {speaker.portraits.length > 0 && !auto && <p className="hint">Com menos de {MIN_AUTO_PORTRAITS} capturas não há escolha automática: pode ser a câmera mostrando outra pessoa. Escolha uma, se for esta voz.</p>}
          <div className="gallery">
            <button type="button" className={`thumb ${!photo ? "on" : ""}`} onClick={() => setPhoto(undefined)} aria-pressed={!photo}>
              {auto ? <img src={auto.image} alt="Escolha automática" /> : <span>auto</span>}
              <small>automática</small>
            </button>
            {speaker.portraits.map((p, i) => (
              <button type="button" key={`${p.hash}-${i}`} className={`thumb ${photo === p.image ? "on" : ""}`} onClick={() => setPhoto(p.image)} aria-pressed={photo === p.image}>
                <img src={p.image} alt={`Captura ${i + 1}`} />
              </button>
            ))}
          </div>
        </fieldset>
        {others.length > 0 && (
          <fieldset>
            <legend>Mesma pessoa em duas vozes?</legend>
            <label className="wide">
              Juntar esta voz com
              <select id="spk-merge" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
                <option value="">escolha…</option>
                {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
            <button type="button" className="btn" disabled={!mergeInto} onClick={() => { onMerge(speaker.id, Number(mergeInto)); onClose(); }}>Juntar vozes</button>
          </fieldset>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn primary">Salvar</button>
        </div>
      </form>
    </dialog>
  );
}
