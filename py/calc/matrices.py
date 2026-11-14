"""
M[…] and V[…]: short ways to type a matrix and a vector. Plain Python objects whose
indexing builds a SymPy Matrix, so the parser needs nothing special.

    M[1, 2, 3]              a row: Matrix([[1, 2, 3]])
    M[[1, 2], [3, 4]]       rows: Matrix([[1, 2], [3, 4]])
    V[1, 2, 3]              a column vector: Matrix([[1, 2, 3]]).T
"""
from sympy import Matrix


class MatrixMaker:
    def __init__(self, name, column):
        self.name = name
        self.column = column

    def __getitem__(self, key):
        items = list(key) if isinstance(key, tuple) else [key]
        if all(isinstance(item, list) for item in items):
            rows = items
        elif not any(isinstance(item, list) for item in items):
            rows = [items]
        else:
            raise TypeError(f"{self.name}[1, 2] is one row, {self.name}[[1, 2], [3, 4]] a list of rows; not both")
        matrix = Matrix(rows)
        return matrix.T if self.column else matrix

    def __repr__(self):
        return self.name


M = MatrixMaker("M", column=False)
V = MatrixMaker("V", column=True)
MAKERS = {"M": M, "V": V}


def matrix_text(matrix, text):
    """Single-line source for a matrix that M[…] / V[…] read back; text() writes the elements."""
    rows = matrix.tolist()
    if not matrix.rows or not matrix.cols:
        return f"zeros({matrix.rows}, {matrix.cols})"
    if matrix.cols == 1 and matrix.rows > 1:
        return f"V[{', '.join(text(row[0]) for row in rows)}]"
    if matrix.rows == 1:
        return f"M[{', '.join(text(e) for e in rows[0])}]"
    return "M[" + ", ".join("[" + ", ".join(text(e) for e in row) + "]" for row in rows) + "]"
