# Bao cao do an Cirtell (LaTeX)

Bo tai lieu nay duoc tao cho de tai:
- Xay dung he thong quan ly vong doi va ton kho thiet bi vien thong

Noi dung hien tai bao gom:
- Chuong 1: Gioi thieu de tai
- Chuong 2: Co so ly thuyet
- Chuong 3: Phan tich va thiet ke he thong (tien do den tuan 7)

## Cau truc
- main.tex
- chapters/chapter1_intro.tex
- chapters/chapter2_theory.tex
- chapters/chapter3_analysis_design_week7.tex

## Bien dich nhanh
Neu da cai TeX Live/MiKTeX:
- pdflatex main.tex
- pdflatex main.tex

(Chay 2 lan de cap nhat muc luc)

## So do Mermaid
Tat ca so do nen co file nguon `.mmd` trong:

- `diagrams/mermaid/`

File render PDF duoc tao vao:

- `diagrams/rendered/`

Tu root repository, chay:

- `npm install`
- `npm run diagrams:render`

Trong LaTeX, nhung so do bang macro:

```tex
\diagramfigure{diagrams/rendered/03-architecture.pdf}{Caption cua hinh}{fig:architecture}
```
