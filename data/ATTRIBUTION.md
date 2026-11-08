# Data attribution

`circuit.bin.gz`, `circuit.json`, `brainmap.bin.gz` and `brainmap.json` are derived from the
**MaleCNS v1.0** connectome: FlyEM / HHMI Janelia, University of Cambridge, MRC LMB, Google Research.
Licensed **CC BY 4.0**: https://male-cns.janelia.org/download/

They were extracted (see `tools/extract.js`) from the preprocessed export published in
https://huggingface.co/spaces/Xenova/fruit-fly-simulation (MIT app code). That export keeps all
annotated neurons and maps transmitters to signs (ACh +1; GABA, glutamate −1; others 0).

Changes made here: a subcircuit of 4,804 neurons (uniglomerular PNs, Kenyon cells, APL, DPM,
MBONs, PAM and PPL1 dopamine neurons) with its induced connections; synapse counts capped at
255; soma positions projected to 2D.

The spiking model follows Shiu et al., "A Drosophila computational brain model reveals sensorimotor
processing", Nature 2024 (https://www.nature.com/articles/s41586-024-07763-9). The plastic
KC→MBON readout, the action assignments of MBON types and the sensory encoding onto glomeruli are
game design choices, not biological claims.
