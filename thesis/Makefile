default:
	pdflatex main.tex

all:
	pdflatex main.tex
	bibtex main
	pdflatex main.tex
	pdflatex main.tex

clean:
	rm -f main.aux main.blg main.bbl main.lof main.log main.lot main.out main.pdf main.toc chapters/*.aux
